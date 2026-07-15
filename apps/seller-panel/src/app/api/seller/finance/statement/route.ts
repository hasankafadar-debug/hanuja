import { type NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { handleError } from '@hanuja/api/lib/response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { SELLER_STATEMENT_EXPORT_HEADERS } from '@hanuja/api/domain/seller-statement-export'
import { createSellerFinanceService } from '@hanuja/api/services/seller-finance.service'
import { getOperationalSellerIdOrThrow } from '@/lib/route-seller'
import { resolveReportingDateRange } from '@hanuja/api/lib/reporting-time'

function parseDateRange(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  return resolveReportingDateRange({ from: from ?? undefined, to: to ?? undefined })
}

export async function GET(req: NextRequest) {
  try {
    const sellerId = await getOperationalSellerIdOrThrow()
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
        fileName: 'muhasebe-ekstresi.csv',
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
        fileName: 'muhasebe-ekstresi.xlsx',
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
