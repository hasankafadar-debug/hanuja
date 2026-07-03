import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import type { OrderStatus } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createOrderService } from '@hanuja/api/services/order.service'

function toDateStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function toDateEnd(value: string) {
  return new Date(`${value}T23:59:59.999Z`)
}

function readStatuses(url: URL) {
  return (url.searchParams.get('status') ?? '')
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean) as OrderStatus[]
}

function normalizeInvoiceFilter(value: string | null): 'missing' | 'present' | undefined {
  return value === 'missing' || value === 'present' ? value : undefined
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatAmount(value: number) {
  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
  return `${formatted} TL`
}

function escapeCsv(value: string | number | null | undefined) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function toNumber(value: { toNumber(): number } | number) {
  return typeof value === 'number' ? value : value.toNumber()
}

function buildOrderCsv(rows: Array<{
  id: string
  createdAt: Date
  status: string
  totalAmount: { toNumber(): number } | number
  customer?: { name?: string | null; email?: string | null } | null
  lines: Array<{
    product?: { name?: string | null } | null
    seller?: {
      displayName?: string | null
      profile?: { companyName?: string | null } | null
    } | null
  }>
  payments: Array<{ method: string; status: string }>
  sellerInvoices: Array<{
    fileName: string
    source: string
    uploadedAt: Date
    seller?: {
      displayName?: string | null
      profile?: { companyName?: string | null } | null
    } | null
  }>
}>) {
  const header = [
    'Siparis No',
    'Tarih',
    'Durum',
    'Musteri',
    'Musteri E-posta',
    'Saticilar',
    'Urunler',
    'Ödeme',
    'Tutar',
    'Fatura Durumu',
    'Fatura Sayisi',
    'Fatura Kaynaklari',
  ]

  const body = rows.map((order) => {
    const orderNumberSource = order as typeof order & { publicNumber?: number | null }
    const sellers = [
      ...new Set(
        order.lines.map(
          (line) => line.seller?.displayName ?? line.seller?.profile?.companyName ?? '',
        ),
      ),
    ].filter(Boolean)
    const products = order.lines.map((line) => line.product?.name ?? 'Urun').join(', ')
    const payments = order.payments.map((payment) => `${payment.method}:${payment.status}`).join(', ')
    const invoiceSources = order.sellerInvoices
      .map((invoice) => {
        const sellerName = invoice.seller?.displayName ?? invoice.seller?.profile?.companyName ?? 'Satici'
        return `${sellerName} / ${invoice.source} / ${formatDate(new Date(invoice.uploadedAt))}`
      })
      .join(', ')

    return [
      formatOrderDisplayNumber(orderNumberSource.publicNumber, order.id),
      formatDate(new Date(order.createdAt)),
      order.status,
      order.customer?.name ?? '',
      order.customer?.email ?? '',
      sellers.join(', '),
      products,
      payments,
      formatAmount(toNumber(order.totalAmount)),
      order.sellerInvoices.length > 0 ? 'Faturali' : 'Faturasiz',
      order.sellerInvoices.length,
      invoiceSources,
    ].map(escapeCsv).join(';')
  })

  return `\uFEFF${[header.map(escapeCsv).join(';'), ...body].join('\r\n')}`
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const seller = url.searchParams.get('seller')?.trim() ?? ''
    const from = url.searchParams.get('from')?.trim() ?? ''
    const to = url.searchParams.get('to')?.trim() ?? ''
    const format = url.searchParams.get('format')?.trim()
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
    const take = Math.min(Math.max(1, Number(url.searchParams.get('take') ?? '20') || 20), 500)
    const status = readStatuses(url)
    const invoice = normalizeInvoiceFilter(url.searchParams.get('invoice'))

    const service = createOrderService({ prisma: createPrismaForRoute() })
    const filters = {
      ...(status.length > 0 ? { status } : {}),
      ...(q ? { query: q } : {}),
      ...(seller ? { sellerId: seller } : {}),
      ...(invoice ? { invoice } : {}),
      ...(from ? { from: toDateStart(from) } : {}),
      ...(to ? { to: toDateEnd(to) } : {}),
    }

    const result = await service.listForAdmin({
      ...filters,
      skip: (page - 1) * take,
      take,
    })

    if (format === 'csv') {
      const exportResult = await service.listForAdmin({
        ...filters,
        skip: 0,
        take: Math.max(result.total, 1),
      })
      const csv = buildOrderCsv(exportResult.rows as Parameters<typeof buildOrderCsv>[0])
      return createBinaryFileResponse({
        body: new TextEncoder().encode(csv),
        contentType: 'text/csv; charset=utf-8',
        fileName: 'admin-siparisler.csv',
      })
    }

    return ok({
      rows: result.rows,
      total: result.total,
      page,
      pageSize: take,
    })
  } catch (error) {
    return handleError(error)
  }
}
