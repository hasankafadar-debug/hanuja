import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '@hanuja/api/lib/errors'
import { created, handleError } from '@hanuja/api/lib/response'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { createOrderDocumentService } from '@hanuja/api/services/order-document.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

interface Context {
  params: Promise<{ id: string }>
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

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const prisma = createPrismaForRoute()
    const sellerId = await getSellerIdOrThrow(session.user.id)
    const { id } = await ctx.params
    const download = new URL(req.url).searchParams.get('download') === '1'
    const service = createOrderDocumentService({ prisma })
    const invoice = await service.getInvoiceForSeller(id, sellerId)
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

export async function POST(req: NextRequest, ctx: Context) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const prisma = createPrismaForRoute()
    const sellerId = await getSellerIdOrThrow(session.user.id)
    const { id } = await ctx.params
    const formData = await req.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      throw new ValidationError('Fatura dosyası seçilmedi.')
    }

    const body = new Uint8Array(await file.arrayBuffer())
    const service = createOrderDocumentService({ prisma })
    const invoice = await service.uploadInvoiceForSeller({
      orderId: id,
      sellerId,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      body,
    })

    return created(invoice)
  } catch (err) {
    return handleError(err)
  }
}
