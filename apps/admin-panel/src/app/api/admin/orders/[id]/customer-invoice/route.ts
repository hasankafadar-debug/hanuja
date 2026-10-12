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
import { createCustomerInvoiceService } from '@hanuja/api/services/customer-invoice.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { DOCUMENT_MAX_SIZE_BYTES } from '@hanuja/api/lib/r2'

interface Context {
  params: Promise<{ id: string }>
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()
  if (session.user.role !== 'admin') throw new ForbiddenError('Admin yetkisi gerekli')
  return session.user
}

/** Hanuja's sales invoice to the customer, issued manually in Uyumsoft (satıcı Hanuja modeli). */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const user = await requireAdmin()
    const { id } = await ctx.params
    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) throw new ValidationError('Fatura dosyası seçilmedi.')
    if (file.size > DOCUMENT_MAX_SIZE_BYTES) throw new ValidationError('Dosya boyutu 20 MB limitini aşıyor.')
    const reason = formData.get('reason')
    const invoiceNumber = formData.get('invoiceNumber')
    const service = createCustomerInvoiceService({ prisma: createPrismaForRoute() })
    return created(
      await service.uploadForAdmin({
        orderId: id,
        actorId: user.id,
        expectedRevision: req.headers.get('if-match'),
        reason: typeof reason === 'string' ? reason : null,
        invoiceNumber: typeof invoiceNumber === 'string' ? invoiceNumber : null,
        fileName: file.name,
        mimeType: file.type,
        body: new Uint8Array(await file.arrayBuffer()),
      }),
    )
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, ctx: Context) {
  try {
    const csrfError = checkCsrf(req)
    if (csrfError) return csrfError
    const user = await requireAdmin()
    const { id } = await ctx.params
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload.reason !== 'string' || payload.reason.trim().length < 5) {
      throw new ValidationError('Silme gerekçesi en az 5 karakter olmalıdır.')
    }
    const service = createCustomerInvoiceService({ prisma: createPrismaForRoute() })
    return ok(
      await service.removeForAdmin({
        orderId: id,
        actorId: user.id,
        expectedRevision: req.headers.get('if-match'),
        reason: payload.reason.trim(),
      }),
    )
  } catch (err) {
    return handleError(err)
  }
}

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const user = await requireAdmin()
    const { id } = await ctx.params
    const download = new URL(req.url).searchParams.get('download') === '1'
    const service = createCustomerInvoiceService({ prisma: createPrismaForRoute() })
    const invoice = await service.getFileForAdmin(id, user.id)
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
