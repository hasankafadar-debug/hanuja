import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { auth } from '@/lib/auth'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import {
  buildBulkCategoryReferenceRows,
  filterBulkCategoryReferenceRows,
  filterBulkCategoryReferenceRowsByScope,
  findBulkCategoryReferenceRowBySlug,
  normalizeCategorySlugValue,
  normalizeRootCategoryValue,
} from '@/lib/bulk-category-options'
import {
  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG,
  BULK_PRODUCT_TEMPLATE_HEADERS,
} from '@/lib/bulk-product-import'
import { sortAttributeOptions } from '@/lib/attribute-option-sort'

const CATEGORY_COL_INDEX =
  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.findIndex((column) => column.key === 'categorySlug') + 1
const PRODUCT_COLOR_COL_INDEX =
  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.findIndex((column) => column.key === 'productColor') + 1
const PRODUCT_SECOND_COLOR_COL_INDEX =
  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.findIndex((column) => column.key === 'secondColor') + 1
const PRODUCT_MATERIAL_COL_INDEX =
  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.findIndex((column) => column.key === 'productMaterial') + 1
const PRICE_COL_INDEX = BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.findIndex((column) => column.key === 'price') + 1
const COMPARE_AT_COL_INDEX =
  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.findIndex((column) => column.key === 'compareAtPrice') + 1

type AttributeOption = {
  id: string
  type: 'color' | 'material'
  label: string
  slug: string
  sortOrder: number
}

function columnLetter(index: number) {
  let value = index
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function normalizeLegacyScopeKey(
  templateCategoryKey: string,
  legacyScopeSlug: string,
  referenceRows: ReturnType<typeof buildBulkCategoryReferenceRows>,
) {
  if (templateCategoryKey) return templateCategoryKey
  if (!legacyScopeSlug) return ''

  const legacyMatch = referenceRows.find((row) => row.realSlug === legacyScopeSlug)
  return legacyMatch?.canonicalKey ?? normalizeCategorySlugValue(legacyScopeSlug)
}

function uniqueLabels(options: AttributeOption[]) {
  return Array.from(new Set(sortAttributeOptions(options).map((option) => option.label)))
}

function buildOptionValidationFormula(params: {
  sheetName: string
  firstColumn: string
  lastColumn: string
  categoryCell: string
}) {
  const { sheetName, firstColumn, lastColumn, categoryCell } = params
  const matchFormula = `MATCH(${categoryCell},'${sheetName}'!$${firstColumn}$1:$${lastColumn}$1,0)`
  const optionColumn = `OFFSET('${sheetName}'!$${firstColumn}$2,0,${matchFormula}-1,200,1)`

  return `OFFSET('${sheetName}'!$${firstColumn}$2,0,${matchFormula}-1,COUNTA(${optionColumn}),1)`
}

function addAttributeOptionSheet(params: {
  workbook: ExcelJS.Workbook
  sheetName: string
  categoryDropdownRows: Array<{ realSlug: string; displayPath: string }>
  labelsByCategorySlug: Map<string, string[]>
}) {
  const { workbook, sheetName, categoryDropdownRows, labelsByCategorySlug } = params
  const sheet = workbook.addWorksheet(sheetName)
  sheet.state = 'veryHidden'

  categoryDropdownRows.forEach((row, columnIndex) => {
    const column = columnIndex + 1
    sheet.getCell(1, column).value = row.displayPath

    for (const [labelIndex, label] of (labelsByCategorySlug.get(row.realSlug) ?? []).entries()) {
      sheet.getCell(labelIndex + 2, column).value = label
    }
  })

  sheet.columns = categoryDropdownRows.map(() => ({ width: 24 }))
}

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const rootCategorySlug = req.nextUrl.searchParams.get('rootCategorySlug')?.trim() ?? ''
  const scopeCategorySlug = req.nextUrl.searchParams.get('scopeCategorySlug')?.trim() ?? ''
  const templateCategoryKey = req.nextUrl.searchParams.get('templateCategoryKey')?.trim() ?? ''
  const legacyScopeSlug = req.nextUrl.searchParams.get('parentCategorySlug')?.trim() ?? ''

  if ((rootCategorySlug && !scopeCategorySlug) || (!rootCategorySlug && scopeCategorySlug)) {
    return NextResponse.json(
      { error: 'Sablon indirmek icin hem alan hem kategori secilmelidir.' },
      { status: 400 },
    )
  }

  const prisma = createPrismaForRoute()
  const catalogSvc = createCatalogService({ prisma })
  const [allCategories, allAttributeOptions, categoriesWithAttributes] = await Promise.all([
    catalogSvc.listAllCategories() as Promise<Array<{
    id: string
    slug: string
    name: string
    parentId: string | null
    isActive: boolean
    }>>,
    prisma.productAttributeOption.findMany({
      where: { isActive: true },
      select: { id: true, type: true, label: true, slug: true, sortOrder: true },
      orderBy: { label: 'asc' },
    }) as Promise<AttributeOption[]>,
    prisma.category.findMany({
      select: {
        slug: true,
        attributeOptions: {
          select: {
            option: {
              select: { id: true, type: true, label: true, slug: true, sortOrder: true },
            },
          },
        },
      },
    }) as Promise<Array<{
      slug: string
      attributeOptions: Array<{ option: AttributeOption }>
    }>>,
  ])

  const referenceRows = buildBulkCategoryReferenceRows(allCategories)
  const usesScopedSelection = Boolean(rootCategorySlug && scopeCategorySlug)

  const scopedReferenceRows = usesScopedSelection
    ? filterBulkCategoryReferenceRowsByScope(referenceRows, rootCategorySlug, scopeCategorySlug)
    : filterBulkCategoryReferenceRows(
        referenceRows,
        normalizeLegacyScopeKey(templateCategoryKey, legacyScopeSlug, referenceRows),
      )

  if (usesScopedSelection) {
    // Only leaf categories have a reference row, so a missing row means the
    // seller stopped on an intermediate category and must drill down further.
    const scopeRow = findBulkCategoryReferenceRowBySlug(referenceRows, scopeCategorySlug)
    const matchesRoot =
      scopeRow && normalizeRootCategoryValue(scopeRow.rootSlug) === normalizeRootCategoryValue(rootCategorySlug)

    if (!matchesRoot || scopedReferenceRows.length === 0) {
      return NextResponse.json(
        { error: 'En alt kategoriyi seçmelisiniz.' },
        { status: 400 },
      )
    }
  }

  const categoryDropdownRows = Array.from(
    new Map(scopedReferenceRows.map((row) => [row.realSlug, row.displayPath])).entries(),
  ).map(([realSlug, displayPath]) => ({ realSlug, displayPath }))

  const fallbackAttributeOptions = {
    color: allAttributeOptions.filter((option) => option.type === 'color'),
    material: allAttributeOptions.filter((option) => option.type === 'material'),
  }
  const attributeOptionsByCategorySlug = new Map(
    categoriesWithAttributes.map((category) => [
      category.slug,
      category.attributeOptions.map((item) => item.option),
    ]),
  )
  const colorLabelsByCategorySlug = new Map<string, string[]>()
  const materialLabelsByCategorySlug = new Map<string, string[]>()

  for (const row of categoryDropdownRows) {
    const categoryOptions = attributeOptionsByCategorySlug.get(row.realSlug) ?? []
    const categoryColors = categoryOptions.filter((option) => option.type === 'color')
    const categoryMaterials = categoryOptions.filter((option) => option.type === 'material')

    colorLabelsByCategorySlug.set(
      row.realSlug,
      uniqueLabels(categoryColors.length > 0 ? categoryColors : fallbackAttributeOptions.color),
    )
    materialLabelsByCategorySlug.set(
      row.realSlug,
      uniqueLabels(categoryMaterials.length > 0 ? categoryMaterials : fallbackAttributeOptions.material),
    )
  }

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Urunler')

  const headerRow = sheet.addRow(BULK_PRODUCT_TEMPLATE_HEADERS)
  headerRow.font = { bold: true }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E2D4' } }

  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.forEach((column, index) => {
    const cell = sheet.getCell(1, index + 1)
    const helpText = ('helpText' in column && column.helpText)
      ? column.helpText
      : `${column.label} alanini urun bilgilerinize uygun olarak girin.`
    cell.note = helpText
  })

  sheet.columns = BULK_PRODUCT_TEMPLATE_HEADERS.map((header) => ({ width: Math.max(header.length + 2, 18) }))

  const refSheet = workbook.addWorksheet('Gecerli Kategoriler')
  refSheet.addRow(['Kategori', 'Gercek Slug', '', 'Kategori Dropdown'])

  for (const row of scopedReferenceRows) {
    refSheet.addRow([row.displayPath, row.realSlug])
  }

  for (const [index, row] of categoryDropdownRows.entries()) {
    refSheet.getCell(index + 2, 4).value = row.displayPath
  }

  refSheet.columns = [
    { width: 44 },
    { width: 40 },
    { width: 4 },
    { width: 44 },
  ]

  addAttributeOptionSheet({
    workbook,
    sheetName: 'Gecerli Renkler',
    categoryDropdownRows,
    labelsByCategorySlug: colorLabelsByCategorySlug,
  })
  addAttributeOptionSheet({
    workbook,
    sheetName: 'Gecerli Materyaller',
    categoryDropdownRows,
    labelsByCategorySlug: materialLabelsByCategorySlug,
  })

  const lastCategoryRow = Math.max(categoryDropdownRows.length + 1, 2)
  const categoryFormula = `'Gecerli Kategoriler'!$D$2:$D$${lastCategoryRow}`
  const categoryCol = columnLetter(CATEGORY_COL_INDEX)
  const lastOptionCol = columnLetter(Math.max(categoryDropdownRows.length, 1))
  const priceCol = columnLetter(PRICE_COL_INDEX)
  const compareAtCol = columnLetter(COMPARE_AT_COL_INDEX)

  for (let rowNum = 2; rowNum <= 502; rowNum++) {
    const categoryCell = `$${categoryCol}${rowNum}`

    sheet.getCell(rowNum, CATEGORY_COL_INDEX).dataValidation = {
      type: 'list',
      allowBlank: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Gecersiz Kategori',
      error: 'Lutfen gecerli kategori listesinden bir kategori secin.',
      formulae: [categoryFormula],
    }

    sheet.getCell(rowNum, PRODUCT_COLOR_COL_INDEX).dataValidation = {
      type: 'list',
      allowBlank: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Gecersiz Renk',
      error: 'Lutfen secilen kategori icin gecerli bir urun rengi secin.',
      formulae: [
        buildOptionValidationFormula({
          sheetName: 'Gecerli Renkler',
          firstColumn: 'A',
          lastColumn: lastOptionCol,
          categoryCell,
        }),
      ],
    }

    // Renk 2 (opsiyonel): Renk 1 ile ayni kategori-bagimli renk listesi, bos birakilabilir.
    sheet.getCell(rowNum, PRODUCT_SECOND_COLOR_COL_INDEX).dataValidation = {
      type: 'list',
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Gecersiz Renk',
      error: 'Lutfen secilen kategori icin gecerli bir ikinci renk secin veya bos birakin.',
      formulae: [
        buildOptionValidationFormula({
          sheetName: 'Gecerli Renkler',
          firstColumn: 'A',
          lastColumn: lastOptionCol,
          categoryCell,
        }),
      ],
    }

    sheet.getCell(rowNum, PRODUCT_MATERIAL_COL_INDEX).dataValidation = {
      type: 'list',
      allowBlank: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Gecersiz Materyal',
      error: 'Lutfen secilen kategori icin gecerli bir materyal secin.',
      formulae: [
        buildOptionValidationFormula({
          sheetName: 'Gecerli Materyaller',
          firstColumn: 'A',
          lastColumn: lastOptionCol,
          categoryCell,
        }),
      ],
    }

    sheet.getCell(rowNum, COMPARE_AT_COL_INDEX).dataValidation = {
      type: 'custom',
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Gecersiz Liste Fiyati',
      error: 'Liste fiyati satis fiyatindan buyuk olmalidir.',
      formulae: [`OR(LEN(${compareAtCol}${rowNum})=0,${compareAtCol}${rowNum}>${priceCol}${rowNum})`],
    }

    BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.forEach((column, index) => {
      const cell = sheet.getCell(rowNum, index + 1)
      const helpText = ('helpText' in column && column.helpText)
        ? column.helpText
        : `${column.label} alanini urun bilgilerinize uygun olarak girin.`
      const validation = cell.dataValidation ?? {}
      cell.dataValidation = {
        ...validation,
        showInputMessage: true,
        promptTitle: column.label,
        prompt: helpText,
      }
    })
  }

  const filename = usesScopedSelection
    ? `toplu-urun-${normalizeRootCategoryValue(rootCategorySlug)}-${normalizeCategorySlugValue(scopeCategorySlug)}.xlsx`
    : (() => {
        const legacyScopeKey = normalizeLegacyScopeKey(templateCategoryKey, legacyScopeSlug, referenceRows)
        const filenameKey = legacyScopeKey
          .replace(/[^a-z0-9-]+/gi, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
        return filenameKey ? `toplu-urun-${filenameKey}.xlsx` : 'toplu-urun-sablonu.xlsx'
      })()

  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
