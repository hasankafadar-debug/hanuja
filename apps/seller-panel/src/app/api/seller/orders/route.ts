import { type NextRequest } from 'next/server'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { handleError } from '@hanuja/api/lib/response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { buildSellerOrderCsv, toSellerSafeOrderDtos } from '@hanuja/api/lib/seller-order-projection'
import { createOrderService } from '@hanuja/api/services/order.service'
import {
  getSellerOrderStatusesForTab,
  isSellerOrderTab,
} from '@hanuja/api/domain/seller-order-tabs'
import { getOperationalSellerIdOrThrow } from '@/lib/route-seller'

function toDateStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function toDateEnd(value: string) {
  return new Date(`${value}T23:59:59.999Z`)
}

export async function GET(req: NextRequest) {
  try {
    const sellerId = await getOperationalSellerIdOrThrow()
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
    const sellerSafeOrders = toSellerSafeOrderDtos(orders)

    if (format === 'csv') {
      const csv = buildSellerOrderCsv(sellerSafeOrders)
      return createBinaryFileResponse({
        body: new TextEncoder().encode(csv),
        contentType: 'text/csv; charset=utf-8',
        fileName: 'siparisler.csv',
      })
    }

    return Response.json({
      success: true,
      data: sellerSafeOrders,
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
