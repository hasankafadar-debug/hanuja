import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError } from '@hanuja/api/lib/response'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { createCustomerInvoiceService } from '@hanuja/api/services/customer-invoice.service'
import { loginRedirectUrl } from '@/lib/login-redirect'

interface Context {
  params: Promise<{ id: string }>
}

/** Hanuja's sales invoice for the signed-in customer's own order (satıcı Hanuja modeli). */
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params
    const session = await auth.api.getSession({ headers: await headers() })
    // Linked from invoice e-mails: send a signed-out reader through login and back here.
    if (!session?.user) {
      return NextResponse.redirect(
        loginRedirectUrl(req, `/api/orders/${encodeURIComponent(id)}/documents/customer-invoice${new URL(req.url).search}`),
      )
    }

    const download = new URL(req.url).searchParams.get('download') === '1'
    const service = createCustomerInvoiceService({ prisma: createPrismaForRoute() })
    const invoice = await service.getForCustomer(id, session.user.id)
    const file = await service.readFile(invoice.fileKey)

    return createBinaryFileResponse({
      body: file.body,
      contentType: invoice.mimeType || 'application/octet-stream',
      fileName: invoice.fileName,
      disposition: download ? 'attachment' : 'inline',
      sizeBytes: invoice.sizeBytes || file.sizeBytes,
    })
  } catch (err) {
    return handleError(err)
  }
}
