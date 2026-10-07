import { type NextRequest, NextResponse } from 'next/server'
import { getCustomerInvoiceUrl } from '@hanuja/api/lib/platform-info'

interface Context {
  params: Promise<{ id: string; sellerId: string }>
}

/** Keep invoice links in previously sent customer e-mails working. */
export async function GET(req: NextRequest, ctx: Context) {
  const { id, sellerId } = await ctx.params
  const response = NextResponse.redirect(
    getCustomerInvoiceUrl(id, sellerId, req.nextUrl.searchParams.get('download') === '1'),
    307,
  )
  response.headers.set('Cache-Control', 'no-store')
  return response
}
