import { type NextRequest } from 'next/server'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { handleError } from '@hanuja/api/lib/response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerFinanceService } from '@hanuja/api/services/seller-finance.service'
import { getActiveSellerIdOrThrow } from '@/lib/route-seller'

function parseDateRange(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  const now = new Date()
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  const defaultFrom = new Date(defaultTo)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29)
  defaultFrom.setUTCHours(0, 0, 0, 0)

  return {
    from: from ? new Date(`${from}T00:00:00.000Z`) : defaultFrom,
    to: to ? new Date(`${to}T23:59:59.999Z`) : defaultTo,
  }
}

export async function GET(req: NextRequest) {
  try {
    const sellerId = await getActiveSellerIdOrThrow()
    const { from, to } = parseDateRange(req)
    const format = req.nextUrl.searchParams.get('format')
    const service = createSellerFinanceService({ prisma: createPrismaForRoute() })
    const statement = await service.getStatement({ sellerId, from, to })

    if (format === 'csv') {
      const csv = service.buildStatementCsv({
        openingBalance: statement.openingBalance,
        rows: statement.rows,
      })
      return createBinaryFileResponse({
        body: new TextEncoder().encode(csv),
        contentType: 'text/csv; charset=utf-8',
        fileName: 'muhasebe-ekstresi.csv',
      })
    }

    return Response.json({
      success: true,
      data: {
        ...statement,
        from,
        to,
      },
    })
  } catch (error) {
    return handleError(error)
  }
}
