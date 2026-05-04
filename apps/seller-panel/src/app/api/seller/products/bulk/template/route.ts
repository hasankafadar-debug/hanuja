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
  BULK_PRODUCT_COLUMN_CONFIG,
  BULK_PRODUCT_TEMPLATE_HEADERS,
} from '@/lib/bulk-product-import'

const CATEGORY_COL_INDEX =
  BULK_PRODUCT_COLUMN_CONFIG.findIndex((column) => column.key === 'categorySlug') + 1
const PRICE_COL_INDEX = BULK_PRODUCT_COLUMN_CONFIG.findIndex((column) => column.key === 'price') + 1
const COMPARE_AT_COL_INDEX =
  BULK_PRODUCT_COLUMN_CONFIG.findIndex((column) => column.key === 'compareAtPrice') + 1

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
  const allCategories = (await catalogSvc.listAllCategories()) as Array<{
    id: string
    slug: string
    name: string
    parentId: string | null
    isActive: boolean
  }>

  const referenceRows = buildBulkCategoryReferenceRows(allCategories)
  const usesScopedSelection = Boolean(rootCategorySlug && scopeCategorySlug)

  const scopedReferenceRows = usesScopedSelection
    ? filterBulkCategoryReferenceRowsByScope(referenceRows, rootCategorySlug, scopeCategorySlug)
    : filterBulkCategoryReferenceRows(
        referenceRows,
        normalizeLegacyScopeKey(templateCategoryKey, legacyScopeSlug, referenceRows),
      )

  if (usesScopedSelection) {
    const scopeRow = findBulkCategoryReferenceRowBySlug(referenceRows, scopeCategorySlug)
    const matchesRoot =
      scopeRow && normalizeRootCategoryValue(scopeRow.rootSlug) === normalizeRootCategoryValue(rootCategorySlug)

    if (!matchesRoot || scopedReferenceRows.length === 0) {
      return NextResponse.json(
        { error: 'Secilen Ev/Ofis ve kategori eslesmesi bulunamadi.' },
        { status: 400 },
      )
    }
  }

  const categoryDropdownRows = Array.from(
    new Map(scopedReferenceRows.map((row) => [row.realSlug, row.displayPath])).entries(),
  ).map(([realSlug, displayPath]) => ({ realSlug, displayPath }))

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Urunler')

  const headerRow = sheet.addRow(BULK_PRODUCT_TEMPLATE_HEADERS)
  headerRow.font = { bold: true }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E2D4' } }

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

  const lastCategoryRow = Math.max(categoryDropdownRows.length + 1, 2)
  const categoryFormula = `'Gecerli Kategoriler'!$D$2:$D$${lastCategoryRow}`
  const priceCol = columnLetter(PRICE_COL_INDEX)
  const compareAtCol = columnLetter(COMPARE_AT_COL_INDEX)

  for (let rowNum = 2; rowNum <= 502; rowNum++) {
    sheet.getCell(rowNum, CATEGORY_COL_INDEX).dataValidation = {
      type: 'list',
      allowBlank: false,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Gecersiz Kategori',
      error: 'Lutfen gecerli kategori listesinden bir kategori secin.',
      formulae: [categoryFormula],
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
