import { type NextRequest, NextResponse } from 'next/server'
import { getCustomerInvoiceUrl } from '@hanuja/api/lib/platform-info'

interface Context {
  params: Promise<{ id: string; sellerId: string }>
}

/** Customer ownership and login are enforced by the receiving web route. */
export async function GET(req: NextRequest, ctx: Context) {
  const { id, sellerId } = await ctx.params
  const response = NextResponse.redirect(
    getCustomerInvoiceUrl(id, sellerId, req.nextUrl.searchParams.get('download') === '1'),
    307,
  )
  response.headers.set('Cache-Control', 'no-store')
  return response
}
