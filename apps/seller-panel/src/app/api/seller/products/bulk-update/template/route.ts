import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { auth } from '@/lib/auth'
import {
  BULK_UPDATE_TEMPLATE_HEADERS,
  BULK_UPDATE_TEMPLATE_SAMPLE_ROW,
} from '@/lib/bulk-product-update'

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    [...BULK_UPDATE_TEMPLATE_HEADERS],
    [BULK_UPDATE_TEMPLATE_SAMPLE_ROW.identifier, BULK_UPDATE_TEMPLATE_SAMPLE_ROW.newPrice, BULK_UPDATE_TEMPLATE_SAMPLE_ROW.newStock],
  ])
  sheet['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(workbook, sheet, 'Guncelleme')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="ornek-toplu-guncelle.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
