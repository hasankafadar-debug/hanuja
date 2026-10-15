import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { adminReturnInvoice } from '@hanuja/api/routes/seller-return-invoices'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'

type Context = { params: Promise<{ id: string; sellerId: string }> }
async function handle(req: NextRequest, ctx: Context) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError('Admin yetkisi gerekli')
    const { id, sellerId } = await ctx.params
    return adminReturnInvoice(req, id, sellerId, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE }
