import { type NextRequest } from 'next/server'
import { createSellerReturnInvoiceService } from '../services/seller-return-invoice.service'
import { createPrismaForRoute } from '../lib/prisma'
import { created, handleError, ok } from '../lib/response'
import { ValidationError } from '../lib/errors'
import { checkCsrf } from '../lib/csrf-check'
import { createBinaryFileResponse } from '../lib/file-response'
import { DOCUMENT_MAX_SIZE_BYTES } from '../lib/r2'

export async function adminReturnInvoice(
  req: NextRequest,
  returnRequestId: string,
  sellerId: string,
  actorId: string,
) {
  try {
    const service = createSellerReturnInvoiceService({
      prisma: createPrismaForRoute(),
    })
    const identity = { returnRequestId, sellerId, actorId }
    if (req.method === 'GET') {
      await service.getForAdmin(identity)
      if (req.nextUrl.searchParams.get('summary') === '1')
        return ok(await service.getForAdmin(identity))
      const file = await service.read(identity)
      return createBinaryFileResponse({
        ...file,
        contentType: file.mimeType,
        disposition: req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline',
      })
    }
    const error = checkCsrf(req)
    if (error) return error
    const expectedRevision = req.headers.get('if-match')
    if (req.method === 'POST') {
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File) || file.size > DOCUMENT_MAX_SIZE_BYTES)
        throw new ValidationError('En fazla 20 MB PDF seçin.')
      return created(
        await service.upload({
          ...identity,
          expectedRevision,
          invoiceNumber: String(form.get('invoiceNumber') ?? ''),
          invoiceDate: String(form.get('invoiceDate') ?? ''),
          reason: String(form.get('reason') ?? ''),
          fileName: file.name,
          mimeType: file.type,
          body: new Uint8Array(await file.arrayBuffer()),
        }),
      )
    }
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object') throw new ValidationError('Geçersiz işlem.')
    const value = body as Record<string, unknown>
    const input = {
      ...identity,
      expectedRevision,
      reason: typeof value.reason === 'string' ? value.reason : '',
    }
    if (req.method === 'DELETE') return ok(await service.remove(input))
    if (
      req.method === 'PATCH' &&
      typeof value.invoiceNumber === 'string' &&
      typeof value.invoiceDate === 'string'
    ) {
      return ok(
        await service.update({
          ...input,
          invoiceNumber: value.invoiceNumber,
          invoiceDate: value.invoiceDate,
        }),
      )
    }
    throw new ValidationError('Geçersiz fatura işlemi.')
  } catch (err) {
    return handleError(err)
  }
}

export async function sellerReturnInvoice(
  req: NextRequest,
  returnRequestId: string,
  sellerId: string,
) {
  try {
    const service = createSellerReturnInvoiceService({
      prisma: createPrismaForRoute(),
    })
    const identity = { returnRequestId, sellerId }
    if (req.nextUrl.searchParams.get('summary') === '1')
      return ok(await service.getForSeller(identity))
    const file = await service.read(identity)
    return createBinaryFileResponse({
      ...file,
      contentType: file.mimeType,
      disposition: req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline',
    })
  } catch (err) {
    return handleError(err)
  }
}
