import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError } from '@hanuja/api/lib/response'
import { createHtmlDownloadResponse } from '@hanuja/api/lib/file-response'
import {
  getContractFileName,
  getContractHtml,
} from '@hanuja/api/lib/order-document-meta'
import { createOrderDocumentService } from '@hanuja/api/services/order-document.service'
import { loginRedirectUrl } from '@/lib/login-redirect'

interface Context {
  params: Promise<{ id: string; kind: string }>
}

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { id, kind } = await ctx.params
    const view = req.nextUrl.searchParams.get('goruntule') === '1'
    const session = await auth.api.getSession({ headers: await headers() })
    // Linked from order e-mails: send a signed-out reader through login and back here.
    if (!session?.user) {
      return NextResponse.redirect(
        loginRedirectUrl(req, `/api/orders/${id}/documents/contracts/${kind}${req.nextUrl.search}`),
      )
    }

    const service = createOrderDocumentService({ prisma: createPrismaForRoute() })
    const snapshot = await service.getContractForCustomer(id, session.user.id)

    return createHtmlDownloadResponse({
      html: getContractHtml(snapshot, kind),
      fileName: getContractFileName(id, kind),
      disposition: view ? 'inline' : 'attachment',
    })
  } catch (err) {
    return handleError(err)
  }
}
