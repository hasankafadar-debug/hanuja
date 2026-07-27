import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { cellText, parseLocaleNumber, parseStock, splitImageUrls, stableHash } from './normalize'
import { categoryMatches, findAmbiguousHeaderFields, findImageColumnsForProfile, mapCategory, REQUIRED_FIELDS, resolveHeaders } from './mapping'
import type { CanonicalField, CanonicalRow, HeaderCandidate, ImportProfile, MappingReport, NormalizedWorkbook } from './types'

function rowValues(row: ExcelJS.Row): unknown[] {
  const values = row.values as unknown[]
  return values.slice(1)
}

export async function discoverWorkbook(sourcePath: string, profile?: ImportProfile): Promise<MappingReport> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(sourcePath)
  const candidates: HeaderCandidate[] = []
  workbook.eachSheet((sheet) => {
    for (let headerRow = 1; headerRow <= Math.min(15, sheet.rowCount); headerRow += 1) {
      const headers = rowValues(sheet.getRow(headerRow))
      const mappedFields = resolveHeaders(headers, profile)
      const ambiguousFields = findAmbiguousHeaderFields(headers, profile)
      const imageColumns = findImageColumnsForProfile(headers, profile)
      const score = Object.keys(mappedFields).length * 10 + imageColumns.length
      if (score > 0) candidates.push({ sheetName: sheet.name, headerRow, score, mappedFields, ambiguousFields, imageColumns })
    }
  })
  candidates.sort((left, right) => right.score - left.score || left.sheetName.localeCompare(right.sheetName) || left.headerRow - right.headerRow)
  const selected = candidates[0]
  const blockingErrors: string[] = []
  if (!selected) blockingErrors.push('Header row could not be detected in the first 15 rows of any sheet.')
  else {
    if (candidates[1]?.score === selected.score) blockingErrors.push('Header mapping is ambiguous; use an explicit profile override.')
    if (selected.ambiguousFields.length) blockingErrors.push(`Ambiguous header fields: ${selected.ambiguousFields.join(', ')}. Use an exact profile override.`)
    for (const field of Object.keys(selected.mappedFields) as CanonicalField[]) {
      const header = rowValues(workbook.getWorksheet(selected.sheetName)!.getRow(selected.headerRow))
      const aliases = [profile?.headerOverrides?.[field]].filter((item): item is string => Boolean(item))
      if (!aliases.length) continue
      const exact = header.map((value, index) => ({ value: String(value ?? '').trim(), index })).filter(({ value }) => value === aliases[0])
      if (exact.length !== 1) blockingErrors.push(`Profile override for ${field} must match exactly one header.`)
    }
    const missing = REQUIRED_FIELDS.filter((field) => selected.mappedFields[field] === undefined)
    if (missing.length) blockingErrors.push(`Required fields missing: ${missing.join(', ')}`)
  }
  return { sourcePath: path.resolve(sourcePath), candidates, selected, blockingErrors }
}

function valueAt(values: unknown[], index: number | undefined): unknown { return index === undefined ? undefined : values[index] }

function textAt(values: unknown[], index: number | undefined) { return cellText(valueAt(values, index)) }

export async function normalizeWorkbook(sourcePath: string, profile?: ImportProfile): Promise<NormalizedWorkbook> {
  const mapping = await discoverWorkbook(sourcePath, profile)
  const sourceHash = createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex')
  if (!mapping.selected) return { schemaVersion: 1, normalizedAt: new Date().toISOString(), sourcePath: path.resolve(sourcePath), sourceHash, mapping, rows: [] }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(sourcePath)
  const sheet = workbook.getWorksheet(mapping.selected.sheetName)
  if (!sheet) throw new Error(`Selected sheet disappeared: ${mapping.selected.sheetName}`)
  const columns = mapping.selected.mappedFields
  const rows: CanonicalRow[] = []
  for (let rowNumber = mapping.selected.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = rowValues(sheet.getRow(rowNumber))
    const modelCode = textAt(values, columns.modelCode)
    const name = textAt(values, columns.name)
    const sourceCategory = textAt(values, columns.category)
    if (!modelCode && !name && !sourceCategory) continue
    const imageUrls = [...new Set(mapping.selected.imageColumns.flatMap((index) => splitImageUrls(valueAt(values, index))))]
    const categoryCandidates = categoryMatches(sourceCategory, profile)
    if (categoryCandidates && categoryCandidates.length > 1) mapping.blockingErrors.push(`Row ${rowNumber}: source category matches multiple profile rules.`)
    rows.push({ sourceRow: rowNumber, modelCode, name, sourceCategory, canonicalCategoryPath: mapCategory(sourceCategory, profile), price: parseLocaleNumber(valueAt(values, columns.price)), compareAtPrice: parseLocaleNumber(valueAt(values, columns.compareAtPrice)), fulfillmentDays: parseLocaleNumber(valueAt(values, columns.fulfillmentDays)), stockQuantity: parseStock(valueAt(values, columns.stock), profile?.stockTextValues), barcode: textAt(values, columns.barcode), sku: textAt(values, columns.sku), description: textAt(values, columns.description), shortDescription: textAt(values, columns.shortDescription), story: textAt(values, columns.story), careInstructions: textAt(values, columns.careInstructions), color1: textAt(values, columns.color1), color2: textAt(values, columns.color2), material: textAt(values, columns.material), weight: parseLocaleNumber(valueAt(values, columns.weight)), dimensionWidth: parseLocaleNumber(valueAt(values, columns.dimensionWidth)), dimensionLength: parseLocaleNumber(valueAt(values, columns.dimensionLength)), dimensionHeight: parseLocaleNumber(valueAt(values, columns.dimensionHeight)), imageUrls })
  }
  return { schemaVersion: 1, normalizedAt: new Date().toISOString(), sourcePath: path.resolve(sourcePath), sourceHash, mapping, rows }
}

export async function writeJson(outputPath: string, value: unknown) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return path.resolve(outputPath)
}
