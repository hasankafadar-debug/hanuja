import { type NextRequest, NextResponse } from 'next/server'
import { getCustomerInvoiceUrl } from '@hanuja/api/lib/platform-info'

interface Context {
  params: Promise<{ id: string; sellerId: string }>
}

/**
 * Links in earlier e-mails pointed at the designer's invoice. In the seller-Hanuja model
 * the customer only receives Hanuja's own invoice, so these links now open that invoice;
 * login and order ownership are enforced by the target route.
 */
export async function GET(req: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const response = NextResponse.redirect(
    getCustomerInvoiceUrl(id, req.nextUrl.searchParams.get('download') === '1'),
    307,
  )
  response.headers.set('Cache-Control', 'no-store')
  return response
}
