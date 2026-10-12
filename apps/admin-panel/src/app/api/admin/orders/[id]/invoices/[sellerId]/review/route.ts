import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { ForbiddenError, UnauthorizedError, ValidationError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { createOrderDocumentService } from '@hanuja/api/services/order-document.service'

interface Context {
  params: Promise<{ id: string; sellerId: string }>
}

const reviewSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    invoiceNumber: z.string().trim().min(1, 'Fatura numarası zorunludur.').max(64),
    invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fatura tarihi zorunludur.'),
  }),
  z.object({
    decision: z.literal('reject'),
    note: z.string().trim().min(5, 'Red gerekçesi en az 5 karakter olmalıdır.').max(1000),
  }),
])

/**
 * Admin review of the seller's invoice to Hanuja (satıcı Hanuja modeli). Approval sets
 * the invoice date that starts the payout term; rejection notifies the seller.
 */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError('Admin yetkisi gerekli')
    const { id, sellerId } = await ctx.params
    const expectedRevision = req.headers.get('if-match')
    if (!expectedRevision) throw new ValidationError('Fatura sürümü gerekli. Sayfayı yenileyin.')
    const parsed = reviewSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Geçersiz istek.')
    }
    const service = createOrderDocumentService({ prisma: createPrismaForRoute() })
    return ok(
      await service.reviewSellerInvoice({
        orderId: id,
        sellerId,
        actorId: session.user.id,
        expectedRevision,
        ...parsed.data,
      }),
    )
  } catch (err) {
    return handleError(err)
  }
}
