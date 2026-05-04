import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { createHtmlDownloadResponse } from '@hanuja/api/lib/file-response'
import {
  getContractFileName,
  getContractHtml,
} from '@hanuja/api/lib/order-document-meta'
import { createOrderDocumentService } from '@hanuja/api/services/order-document.service'

interface Context {
  params: Promise<{ id: string; kind: string }>
}

export async function GET(_req: NextRequest, ctx: Context) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError('Admin yetkisi gerekli')

    const { id, kind } = await ctx.params
    const service = createOrderDocumentService({ prisma: createPrismaForRoute() })
    const snapshot = await service.getContractForAdmin(id)

    return createHtmlDownloadResponse({
      html: getContractHtml(snapshot, kind),
      fileName: getContractFileName(id, kind),
    })
  } catch (err) {
    return handleError(err)
  }
}
