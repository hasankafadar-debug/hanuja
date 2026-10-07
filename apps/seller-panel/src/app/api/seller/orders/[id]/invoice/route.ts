import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '@hanuja/api/lib/errors'
import { created, handleError, ok } from '@hanuja/api/lib/response'
import { createBinaryFileResponse } from '@hanuja/api/lib/file-response'
import { createOrderDocumentService } from '@hanuja/api/services/order-document.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { DOCUMENT_MAX_SIZE_BYTES } from '@hanuja/api/lib/r2'

interface Context {
  params: Promise<{ id: string }>
}

async function getSellerIdOrThrow(userId: string) {
  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({
    where: { userId },
    select: { id: true, status: true },
  })

  if (
    !seller ||
    (seller.status !== 'active' && seller.status !== 'suspended')
  ) {
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
      contentType:
        invoice.mimeType || file.contentType || 'application/octet-stream',
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
    if (file.size > DOCUMENT_MAX_SIZE_BYTES) {
      throw new ValidationError('Dosya boyutu 20 MB limitini aşıyor.')
    }

    const body = new Uint8Array(await file.arrayBuffer())
    const service = createOrderDocumentService({ prisma })
    const invoice = await service.uploadInvoiceForSeller({
      orderId: id,
      sellerId,
      actorId: session.user.id,
      expectedRevision: req.headers.get('if-match'),
      reason:
        typeof formData.get('reason') === 'string'
          ? (formData.get('reason') as string)
          : null,
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

export async function DELETE(req: NextRequest, ctx: Context) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    const sellerId = await getSellerIdOrThrow(session.user.id)
    const { id } = await ctx.params
    const payload = await req.json().catch(() => null)
    if (
      !payload ||
      typeof payload.reason !== 'string' ||
      payload.reason.trim().length < 5
    ) {
      throw new ValidationError('Silme gerekçesi en az 5 karakter olmalıdır.')
    }
    const service = createOrderDocumentService({
      prisma: createPrismaForRoute(),
    })
    return ok(
      await service.removeInvoiceForSeller({
        orderId: id,
        sellerId,
        actorId: session.user.id,
        expectedRevision: req.headers.get('if-match'),
        reason: payload.reason.trim(),
      }),
    )
  } catch (err) {
    return handleError(err)
  }
}
