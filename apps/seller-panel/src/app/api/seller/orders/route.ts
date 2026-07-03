import { type NextRequest } from 'next/server'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { handleError } from '@hanuja/api/lib/response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { createOrderService } from '@hanuja/api/services/order.service'
import { getSellerOrderStatusesForTab, isSellerOrderTab } from '@hanuja/api/domain/seller-order-tabs'
import { maskCustomerName } from '@hanuja/security'
import { getActiveSellerIdOrThrow } from '@/lib/route-seller'

function toDateStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function toDateEnd(value: string) {
  return new Date(`${value}T23:59:59.999Z`)
}

function buildOrderCsv(rows: Array<{
  id: string
  createdAt: Date
  status: string
  customer?: { name?: string | null } | null
  lines: Array<{
    quantity: number
    unitPrice: { toNumber(): number } | number
    product: { name: string } | null
  }>
}>) {
  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date)
  const formatAmount = (value: number) =>
    `${new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)} TL`
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`

  const header = ['Siparis No', 'Tarih', 'Musteri', 'Durum', 'Urunler', 'Toplam']
  const body = rows.map((order) => {
    const orderNumberSource = order as typeof order & { publicNumber?: number | null }
    const total = order.lines.reduce((sum, line) => {
      const price =
        typeof line.unitPrice === 'object' && 'toNumber' in line.unitPrice
          ? line.unitPrice.toNumber()
          : Number(line.unitPrice)
      return sum + price * line.quantity
    }, 0)
    const products = order.lines.map((line) => line.product?.name ?? 'Urun').join(', ')
    return [
      escape(formatOrderDisplayNumber(orderNumberSource.publicNumber, order.id)),
      escape(formatDate(new Date(order.createdAt))),
      escape(maskCustomerName(order.customer?.name)),
      escape(order.status),
      escape(products),
      escape(formatAmount(total)),
    ].join(';')
  })

  return `\uFEFF${[header.map(escape).join(';'), ...body].join('\r\n')}`
}

export async function GET(req: NextRequest) {
  try {
    const sellerId = await getActiveSellerIdOrThrow()
    const url = new URL(req.url)
    const tab = url.searchParams.get('tab')?.trim()
    const q = url.searchParams.get('q')?.trim() ?? undefined
    const from = url.searchParams.get('from')?.trim()
    const to = url.searchParams.get('to')?.trim()
    const format = url.searchParams.get('format')?.trim()
    const page = Number(url.searchParams.get('page') ?? '1')
    const take = Number(url.searchParams.get('take') ?? '20')
    const skip = Math.max(0, page - 1) * take

    const service = createOrderService({ prisma: createPrismaForRoute() })
    const missingInvoice = tab === 'faturasi-olmayanlar'
    const listParams = {
      sellerId,
      ...(tab && isSellerOrderTab(tab) ? { status: getSellerOrderStatusesForTab(tab) } : {}),
      ...(missingInvoice ? { missingInvoice: true } : {}),
      ...(q ? { query: q } : {}),
      ...(from ? { from: toDateStart(from) } : {}),
      ...(to ? { to: toDateEnd(to) } : {}),
    }
    const total = await service.countForSellerQueue(listParams)
    const orders = await service.listForSellerQueue({
      ...listParams,
      skip: format === 'csv' ? 0 : skip,
      take: format === 'csv' ? Math.max(total, 1) : take,
    })

    if (format === 'csv') {
      const csv = buildOrderCsv(
        orders as Array<{
          id: string
          createdAt: Date
          status: string
          customer?: { name?: string | null } | null
          lines: Array<{
            quantity: number
            unitPrice: { toNumber(): number } | number
            product: { name: string } | null
          }>
        }>,
      )
      return createBinaryFileResponse({
        body: new TextEncoder().encode(csv),
        contentType: 'text/csv; charset=utf-8',
        fileName: 'siparisler.csv',
      })
    }

    return Response.json({
      success: true,
      data: orders,
      meta: {
        total,
        page,
        pageSize: take,
      },
    })
  } catch (error) {
    return handleError(error)
  }
}
