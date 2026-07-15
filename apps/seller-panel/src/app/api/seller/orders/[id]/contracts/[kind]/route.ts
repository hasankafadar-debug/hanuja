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

async function getSellerIdOrThrow(userId: string) {
  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({
    where: { userId },
    select: { id: true, status: true },
  })

  if (!seller || (seller.status !== 'active' && seller.status !== 'suspended')) {
    throw new ForbiddenError('Aktif satıcı hesabı gerekli')
  }

  return seller.id
}

export async function GET(_req: NextRequest, ctx: Context) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const prisma = createPrismaForRoute()
    const sellerId = await getSellerIdOrThrow(session.user.id)
    const { id, kind } = await ctx.params
    const service = createOrderDocumentService({ prisma })
    const snapshot = await service.getContractForSeller(id, sellerId)

    return createHtmlDownloadResponse({
      html: getContractHtml(snapshot, kind),
      fileName: getContractFileName(id, kind),
    })
  } catch (err) {
    return handleError(err)
  }
}
