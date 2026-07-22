import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { createOrderDocumentService } from '@hanuja/api/services/order-document.service'

interface Context {
  params: Promise<{ id: string; sellerId: string }>
}

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const { id, sellerId } = await ctx.params
    const download = new URL(req.url).searchParams.get('download') === '1'
    const service = createOrderDocumentService({ prisma: createPrismaForRoute() })
    const invoice = await service.getInvoiceForCustomer(id, session.user.id, sellerId)
    const file = await service.readInvoiceFile(invoice.fileKey)

    return createBinaryFileResponse({
      body: file.body,
      contentType: invoice.mimeType || file.contentType || 'application/octet-stream',
      fileName: invoice.fileName,
      disposition: download ? 'attachment' : 'inline',
      sizeBytes: invoice.sizeBytes || file.sizeBytes,
    })
  } catch (err) {
    return handleError(err)
  }
}
