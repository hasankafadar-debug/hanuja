import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError } from '@hanuja/api/lib/response'
import { SELLER_STATEMENT_EXPORT_HEADERS } from '@hanuja/api/domain/seller-statement-export'
import { createSellerFinanceService } from '@hanuja/api/services/seller-finance.service'

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { id: sellerId } = await params
    const { from, to } = parseDateRange(req)
    const format = req.nextUrl.searchParams.get('format')
    const service = createSellerFinanceService({ prisma: createPrismaForRoute() })
    const statement = await service.getStatement({ sellerId, from, to })

    if (format === 'csv') {
      const csv = service.buildStatementCsv({
        from,
        openingBalance: statement.openingBalance,
        rows: statement.rows,
      })
      return createBinaryFileResponse({
        body: new TextEncoder().encode(csv),
        contentType: 'text/csv; charset=utf-8',
        fileName: 'hesap-ekstresi.csv',
      })
    }

    if (format === 'xlsx') {
      const exportRows = service.buildStatementExportRows({
        from,
        openingBalance: statement.openingBalance,
        rows: statement.rows,
      })
      const worksheet = XLSX.utils.json_to_sheet(exportRows, {
        header: [...SELLER_STATEMENT_EXPORT_HEADERS],
      })
      worksheet['!cols'] = [
        { wch: 12 },
        { wch: 18 },
        { wch: 18 },
        { wch: 30 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
      ]
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Ekstre')
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

      return createBinaryFileResponse({
        body: new Uint8Array(buffer),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: 'hesap-ekstresi.xlsx',
        sizeBytes: buffer.byteLength,
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
