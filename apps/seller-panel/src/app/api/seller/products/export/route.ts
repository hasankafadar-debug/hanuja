import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { auth } from '@/lib/auth'
import {
  BULK_PRODUCT_COLUMN_CONFIG,
  BULK_PRODUCT_IMAGE_COLUMN_COUNT,
  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG,
  BULK_PRODUCT_TEMPLATE_HEADERS,
  type BulkProductColumnKey,
} from '@/lib/bulk-product-import'
import { buildBulkCategoryReferenceRows } from '@/lib/bulk-category-options'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

type ExportCell = string | number
type ExportRow = Record<BulkProductColumnKey, ExportCell>

type DecimalLike = {
  toNumber(): number
}

function decimalToNumber(value: DecimalLike | number | null | undefined) {
  if (value === null || value === undefined) return undefined
  return typeof value === 'number' ? value : value.toNumber()
}

function emptyExportRow(): ExportRow {
  return Object.fromEntries(
    BULK_PRODUCT_COLUMN_CONFIG.map((column) => [column.key, '']),
  ) as ExportRow
}

function getOptionValue(options: unknown, key: string) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return ''

  const value = (options as Record<string, unknown>)[key]
  if (value === null || value === undefined) return ''

  return String(value).trim()
}

function getAttributeValue(
  attributeValues: Array<{ option: { type: string; label: string } }>,
  type: 'color' | 'material',
) {
  return attributeValues.find((value) => value.option.type === type)?.option.label ?? ''
}

function getFirstCustomOption(options: unknown) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return { name: '', value: '' }
  }

  for (const [name, value] of Object.entries(options as Record<string, unknown>)) {
    if (name === 'Renk' || name === 'Materyal' || name === 'Beden') continue

    const normalizedValue = value === null || value === undefined ? '' : String(value).trim()
    if (normalizedValue) return { name, value: normalizedValue }
  }

  return { name: '', value: '' }
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })

  if (!seller) {
    return NextResponse.json({ error: 'Satici hesabi bulunamadi.' }, { status: 404 })
  }

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { sellerId: seller.id },
      include: {
        category: true,
        images: {
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          take: BULK_PRODUCT_IMAGE_COLUMN_COUNT,
        },
        variants: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        attributeValues: {
          include: {
            option: {
              select: { type: true, label: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.category.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        parentId: true,
        isActive: true,
      },
    }),
  ])

  const categoryDisplayBySlug = new Map(
    buildBulkCategoryReferenceRows(categories).map((row) => [row.realSlug, row.displayPath]),
  )

  const exportRows: ExportRow[] = products.flatMap((product): ExportRow[] => {
    const baseRow = emptyExportRow()
    baseRow.name = product.name
    baseRow.categorySlug = product.category?.slug
      ? categoryDisplayBySlug.get(product.category.slug) ?? product.category.slug
      : ''
    baseRow.productColor = getAttributeValue(product.attributeValues, 'color')
    baseRow.productMaterial = getAttributeValue(product.attributeValues, 'material')
    baseRow.modelCode = product.modelCode ?? ''
    baseRow.sku = product.sku ?? ''
    baseRow.shortDescription = product.shortDescription ?? ''
    baseRow.description = product.description ?? ''
    baseRow.story = product.story ?? ''
    baseRow.careInstructions = product.careInstructions ?? ''
    baseRow.compareAtPrice = decimalToNumber(product.compareAtPrice) ?? ''
    baseRow.weight = decimalToNumber(product.weight) ?? ''

    product.images.forEach((image, index) => {
      const key = `image${index + 1}` as BulkProductColumnKey
      baseRow[key] = image.url
    })

    if (product.variants.length === 0) {
      const row: ExportRow = {
        ...baseRow,
        price: decimalToNumber(product.price) ?? '',
        stockQuantity: product.stockQuantity,
        barcode: product.barcode ?? '',
      }

      return [row]
    }

    return product.variants.map((variant) => {
      const customOption = getFirstCustomOption(variant.options)

      return {
        ...baseRow,
        price: decimalToNumber(variant.price ?? product.price) ?? '',
        stockQuantity: variant.stockQuantity,
        barcode: variant.barcode,
        variantColor: getOptionValue(variant.options, 'Renk'),
        variantMaterial: getOptionValue(variant.options, 'Materyal'),
        variantSize: getOptionValue(variant.options, 'Beden'),
        variantCustomOptionName: customOption.name,
        variantCustomOptionValue: customOption.value,
      }
    })
  })

  const sheetRows = [
    BULK_PRODUCT_TEMPLATE_HEADERS,
    ...exportRows.map((row) => BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.map((column) => row[column.key] ?? '')),
  ]
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows)
  worksheet['!cols'] = BULK_PRODUCT_TEMPLATE_HEADERS.map((header) => ({
    wch: Math.max(header.length + 2, 18),
  }))
  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.forEach((column, index) => {
    const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c: index })]
    if (!cell) return
    cell.c = [{
      a: 'Hanuja',
      t: ('helpText' in column && column.helpText)
        ? column.helpText
        : `${column.label} alanini urun bilgilerinize uygun olarak girin.`,
    }]
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Urunler')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  return createBinaryFileResponse({
    body: new Uint8Array(buffer),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: 'urunlerim.xlsx',
    sizeBytes: buffer.byteLength,
  })
}
