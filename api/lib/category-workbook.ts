import ExcelJS from 'exceljs'
import {
  allowedSizeValues,
  fieldOptions,
  type ResolvedCategorySchema,
} from '../domain/category-schema'

export interface CategoryWorkbookMetadata {
  categoryId: string
  templateCode: string
  schemaVersion: number
  propertyHeaders: Record<string, string>
  variantHeader: string | null
  contentUnitHeader: string | null
}
export async function createCategoryWorkbook(
  schema: ResolvedCategorySchema,
  baseColumns: Array<{ key: string; label: string; required: boolean; helpText: string }>,
  categoryPath: string,
  colors: string[],
  materials: string[],
) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Hanuja'
  const sheet = workbook.addWorksheet('Ürünler', { views: [{ state: 'frozen', ySplit: 1 }] })
  const options = workbook.addWorksheet('Seçenekler')
  options.state = 'veryHidden'
  const instructions = workbook.addWorksheet('Açıklamalar')
  const metadata: CategoryWorkbookMetadata = {
    categoryId: schema.categoryId,
    templateCode: schema.templateCode,
    schemaVersion: schema.schemaVersion,
    propertyHeaders: {},
    variantHeader: null,
    contentUnitHeader: null,
  }
  const variableKeys =
    schema.config.variantKey === 'net_icerik'
      ? schema.config.contentKeys
      : schema.config.variantKey
        ? [schema.config.variantKey]
        : []
  const columns = baseColumns
    .filter(
      (c) =>
        !['variantColor', 'variantMaterial'].includes(c.key) &&
        (schema.config.shared.color || !['productColor', 'secondColor'].includes(c.key)) &&
        (schema.config.shared.material || c.key !== 'productMaterial') &&
        (schema.config.shared.dimensions || !c.key.startsWith('dimension')) &&
        (Boolean(schema.config.variantKey) ||
          !['variantSize', 'variantCustomOptionName', 'variantCustomOptionValue'].includes(c.key)),
    )
    .map((c) => {
      if (c.key !== 'variantSize')
        return { ...c, required: c.key === 'productColor' ? false : c.required }
      const definition = schema.definitions.find((d) => d.key === schema.config.variantKey)
      const label = `${schema.config.variantLabel}${definition?.canonicalUnit && definition.canonicalUnit !== '—' ? ` (${definition.canonicalUnit})` : ''}`
      metadata.variantHeader = label
      return {
        ...c,
        label,
        required: false,
        helpText: 'Varyant değerini girin. Her varyantın ayrı barkodu, fiyatı ve stoğu vardır.',
      }
    })
  for (const binding of schema.config.fields.filter((f) => !variableKeys.includes(f.key))) {
    const definition = schema.definitions.find((d) => d.key === binding.key)!
    const label = `${definition.label}${definition.canonicalUnit && definition.canonicalUnit !== '—' ? ` (${definition.canonicalUnit})` : ''}${binding.required ? '*' : ''}`
    metadata.propertyHeaders[label] = binding.key
    columns.push({
      key: `property:${binding.key}`,
      label,
      required: binding.required,
      helpText:
        definition.kind === 'number'
          ? `Kanonik birim: ${definition.canonicalUnit}. Sayı olarak girin.`
          : 'Listeden seçin veya metni girin.',
    })
  }
  if (schema.config.variantKey === 'net_icerik') {
    metadata.contentUnitHeader = 'Net İçerik Birimi'
    columns.push({
      key: 'contentUnit',
      label: metadata.contentUnitHeader,
      required: false,
      helpText: 'ml, g veya adet. Aynı ürünün bütün varyantlarında aynı olmalıdır.',
    })
  }
  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.key.startsWith('image') ? 34 : Math.min(36, Math.max(19, c.label.length + 4)),
  }))
  sheet.getRow(1).height = 36
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF23372D' } }
    cell.alignment = { wrapText: true, vertical: 'middle' }
  })
  instructions.columns = [
    { header: 'Alan', key: 'label', width: 32 },
    { header: 'Açıklama', key: 'helpText', width: 95 },
  ]
  for (const column of columns) instructions.addRow(column)
  instructions.addRow({ label: 'Kategori', helpText: categoryPath })
  instructions.addRow({
    label: 'Renk / Materyal',
    helpText: 'Ürün düzeyindedir. Farklı renkleri aynı Model Kodu ile ayrı ürünler olarak ekleyin.',
  })
  if (schema.templateCode === 'BEB-BEZ')
    instructions.addRow({
      label: 'Paket Adedi',
      helpText: 'Bütün numara varyantlarında ortak adettir. Farklı adetleri ayrı ürün yapın.',
    })
  const columnLetter = (i: number) => {
    let out = ''
    while (i) {
      i--
      out = String.fromCharCode(65 + (i % 26)) + out
      i = Math.floor(i / 26)
    }
    return out
  }
  let optionCol = 0
  const list = (values: string[], name: string) => {
    if (!values.length) return ''
    optionCol++
    options.getCell(1, optionCol).value = name
    values.forEach((v, i) => (options.getCell(i + 2, optionCol).value = v))
    const letter = columnLetter(optionCol)
    workbook.definedNames.add(`'Seçenekler'!$${letter}$2:$${letter}$${values.length + 1}`, name)
    return name
  }
  const sizeLists = {
    adult: list(allowedSizeValues(schema, 'yetiskin'), 'BedenYetiskin'),
    child: list(allowedSizeValues(schema, 'cocuk'), 'BedenCocuk'),
    baby: list(allowedSizeValues(schema, 'bebek'), 'BedenBebek'),
  }
  const ageIndex = columns.findIndex((c) => c.key === 'property:yas_grubu') + 1
  const categoryIndex = columns.findIndex((c) => c.key === 'categorySlug') + 1
  if (categoryIndex) sheet.getCell(2, categoryIndex).value = categoryPath
  for (const [index, column] of columns.entries()) {
    let formula = ''
    const key = column.key.startsWith('property:')
      ? column.key.slice(9)
      : column.key === 'variantSize'
        ? schema.config.variantKey
        : null
    const definition = schema.definitions.find((d) => d.key === key)
    if (key === 'beden')
      formula = ageIndex
        ? `IF(${columnLetter(ageIndex)}ROW="Bebek",${sizeLists.baby},IF(${columnLetter(ageIndex)}ROW="Çocuk",${sizeLists.child},${sizeLists.adult}))`
        : sizeLists.adult
    else if (definition?.kind === 'select')
      formula = list(
        fieldOptions(schema, schema.config.fields.find((f) => f.key === key)!).map((o) => o.label),
        `Liste${index}`,
      )
    else if (definition?.kind === 'boolean') formula = list(['Evet', 'Hayır'], `Liste${index}`)
    else if (column.key === 'contentUnit')
      formula = list(
        schema.config.contentKeys
          .map(
            (k) =>
              (
                ({ hacim_ml: 'ml', net_agirlik_g: 'g', paket_adedi: 'adet' }) as Record<
                  string,
                  string
                >
              )[k]!,
          )
          .filter(Boolean),
        `Liste${index}`,
      )
    else if (['productColor', 'secondColor'].includes(column.key))
      formula = list(colors, `Liste${index}`)
    else if (column.key === 'productMaterial') formula = list(materials, `Liste${index}`)
    if (formula)
      for (let row = 2; row <= 1001; row++)
        sheet.getCell(row, index + 1).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [formula.replace(/ROW/g, String(row))],
          showErrorMessage: true,
          errorTitle: 'Geçersiz değer',
          error: 'Bu alan için listeden bir değer seçin.',
        }
  }
  const meta = workbook.addWorksheet('__schema')
  meta.state = 'veryHidden'
  meta.getCell('A1').value = JSON.stringify(metadata)
  return workbook.xlsx.writeBuffer()
}
