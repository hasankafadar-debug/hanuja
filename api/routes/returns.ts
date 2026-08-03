/**
 * Return route handlers — thin: validate → auth → service → respond.
 * Business logic lives in api/services/return.service.ts, not here.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, created, handleError } from '../lib/response'
import { createReturnService } from '../services/return.service'
import { createPrismaForRoute } from '../lib/prisma'

const assetIds = z.array(z.string().min(1)).max(10).optional()

const openRequestSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(3, 'Sebep en az 3 karakter olmalı'),
  description: z.string().optional(),
  evidenceAssetIds: assetIds,
})

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reviewNote: z.string().optional(),
})

const markReceivedSchema = z.object({
  refundAmount: z.number().positive('İade tutarı pozitif olmalı'),
})

const addMessageSchema = z.object({
  body: z.string().min(1, 'Mesaj boş olamaz'),
  attachmentAssetIds: assetIds,
})

const sellerCargoInfoSchema = z.object({
  address: z.string().min(5, 'İade adresi en az 5 karakter olmalı'),
  carrier: z.string().min(2, 'Kargo firması gerekli'),
  instructions: z.string().optional(),
})

const customerShipmentSchema = z
  .object({
    carrier: z.string().min(2, 'Kargo firması gerekli'),
    trackingNumber: z.string().optional(),
    barcodeAssetId: z.string().optional(),
  })
  .refine((v) => Boolean(v.trackingNumber) || Boolean(v.barcodeAssetId), {
    message: 'Kargo takip numarası veya kargo barkod görseli gerekli',
  })

const rejectSchema = z.object({
  reason: z.string().min(3, 'Sebep en az 3 karakter olmalı'),
  description: z.string().optional(),
  evidenceAssetIds: assetIds,
})

function getReturnService() {
  const prisma = createPrismaForRoute()
  return createReturnService({ prisma })
}

type MediaWithDirectUrl = {
  url: string
  key?: string | null
  variants?: unknown
}

function toPrivateMediaReference<T extends MediaWithDirectUrl>(asset: T) {
  const { url: _url, key: _key, variants: _variants, ...reference } = asset
  return reference
}

function toPrivateReturnMessage<T extends { attachments: MediaWithDirectUrl[] }>(message: T) {
  return {
    ...message,
    attachments: message.attachments.map(toPrivateMediaReference),
  }
}

function toPrivateReturnRequest<
  T extends {
    evidence: MediaWithDirectUrl[]
    messages: { attachments: MediaWithDirectUrl[] }[]
  },
>(returnRequest: T) {
  return {
    ...returnRequest,
    evidence: returnRequest.evidence.map(toPrivateMediaReference),
    messages: returnRequest.messages.map(toPrivateReturnMessage),
  }
}

// POST /api/returns — müşteri iade talebi açar
export async function openReturnRequest(req: NextRequest, customerId: string) {
  try {
    const body = await req.json()
    const { orderId, reason, description, evidenceAssetIds } = openRequestSchema.parse(body)
    const svc = getReturnService()
    const returnRequest = await svc.openRequest({
      orderId,
      customerId,
      reason,
      ...(description !== undefined ? { description } : {}),
      ...(evidenceAssetIds !== undefined ? { evidenceAssetIds } : {}),
    })
    return created(returnRequest)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/returns/:id — iade detayı (müşteri)
export async function getReturnRequest(returnRequestId: string) {
  try {
    const svc = getReturnService()
    const returnRequest = await svc.getRequest(returnRequestId)
    return ok(returnRequest ? toPrivateReturnRequest(returnRequest) : null)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/returns/:id — müşteri iade detayı (ownership-scoped)
export async function getReturnRequestForCustomer(returnRequestId: string, customerId: string) {
  try {
    const svc = getReturnService()
    const rr = await svc.getRequest(returnRequestId)
    if (!rr || rr.customerId !== customerId) {
      const { NotFoundError } = await import('../lib/errors')
      throw new NotFoundError('ReturnRequest', returnRequestId)
    }
    return ok(toPrivateReturnRequest(rr))
  } catch (err) {
    return handleError(err)
  }
}

// GET seller iade detayı (ownership-scoped)
export async function getReturnRequestForSeller(returnRequestId: string, sellerId: string) {
  try {
    const svc = getReturnService()
    const returnRequest = await svc.getRequestForSeller(returnRequestId, sellerId)
    if (!returnRequest) {
      const { NotFoundError } = await import('../lib/errors')
      throw new NotFoundError('ReturnRequest', returnRequestId)
    }
    return ok(toPrivateReturnRequest(returnRequest))
  } catch (err) {
    return handleError(err)
  }
}

// GET seller iade listesi
export async function listReturnsForSeller(req: NextRequest, sellerId: string) {
  try {
    const url = new URL(req.url)
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '30')
    const svc = getReturnService()
    const rows = await svc.listForSeller({ sellerId, skip, take })
    return ok(rows)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/returns/:id/messages — mesaj ekle (customer, seller, admin)
export async function addReturnMessage(
  req: NextRequest,
  returnRequestId: string,
  authorId: string,
  authorRole: 'customer' | 'seller' | 'admin',
) {
  try {
    const body = await req.json()
    const { body: messageBody, attachmentAssetIds } = addMessageSchema.parse(body)
    const svc = getReturnService()
    const message = await svc.addMessage({
      returnRequestId,
      authorId,
      authorRole,
      body: messageBody,
      ...(attachmentAssetIds !== undefined ? { attachmentAssetIds } : {}),
    })
    if (!message) {
      const { NotFoundError } = await import('../lib/errors')
      throw new NotFoundError('ReturnMessage', returnRequestId)
    }
    return created(toPrivateReturnMessage(message))
  } catch (err) {
    return handleError(err)
  }
}

// POST customer iade mesajı — sahiplik doğrulamalı
export async function addCustomerReturnMessage(
  req: NextRequest,
  returnRequestId: string,
  customerId: string,
) {
  try {
    const svc = getReturnService()
    const rr = await svc.getRequest(returnRequestId)
    if (!rr || rr.customerId !== customerId) {
      const { NotFoundError } = await import('../lib/errors')
      throw new NotFoundError('ReturnRequest', returnRequestId)
    }
    return addReturnMessage(req, returnRequestId, customerId, 'customer')
  } catch (err) {
    return handleError(err)
  }
}

// POST seller iade mesajı — sahiplik doğrulamalı
export async function addSellerReturnMessage(
  req: NextRequest,
  returnRequestId: string,
  sellerId: string,
  sellerUserId: string,
) {
  try {
    const svc = getReturnService()
    const rr = await svc.getRequestForSeller(returnRequestId, sellerId)
    if (!rr) {
      const { NotFoundError } = await import('../lib/errors')
      throw new NotFoundError('ReturnRequest', returnRequestId)
    }
    return addReturnMessage(req, returnRequestId, sellerUserId, 'seller')
  } catch (err) {
    return handleError(err)
  }
}

// POST seller iade kargo bilgisi girer
export async function provideReturnCargoInfo(
  req: NextRequest,
  returnRequestId: string,
  sellerId: string,
) {
  try {
    const body = await req.json()
    const { address, carrier, instructions } = sellerCargoInfoSchema.parse(body)
    const svc = getReturnService()
    const updated = await svc.provideSellerCargoInfo({
      returnRequestId,
      sellerId,
      address,
      carrier,
      ...(instructions !== undefined ? { instructions } : {}),
    })
    return ok(updated)
  } catch (err) {
    return handleError(err)
  }
}

// POST müşteri iade kargo bilgilerini girer
export async function submitReturnShipment(
  req: NextRequest,
  returnRequestId: string,
  customerId: string,
) {
  try {
    const body = await req.json()
    const { carrier, trackingNumber, barcodeAssetId } = customerShipmentSchema.parse(body)
    const svc = getReturnService()
    const updated = await svc.submitCustomerShipment({
      returnRequestId,
      customerId,
      carrier,
      ...(trackingNumber !== undefined ? { trackingNumber } : {}),
      ...(barcodeAssetId !== undefined ? { barcodeAssetId } : {}),
    })
    return ok(updated)
  } catch (err) {
    return handleError(err)
  }
}

// POST seller iade ürününü teslim aldı, onayladı → otomatik refund
export async function confirmReturnReceipt(
  _req: NextRequest,
  returnRequestId: string,
  sellerId: string,
) {
  try {
    const svc = getReturnService()
    const updated = await svc.confirmReceiptBySeller({
      returnRequestId,
      sellerId,
    })
    return ok(updated)
  } catch (err) {
    return handleError(err)
  }
}

// POST seller iade ürününü reddetti → uyuşmazlığa eskale
export async function rejectReturnReceipt(
  req: NextRequest,
  returnRequestId: string,
  sellerId: string,
) {
  try {
    const body = await req.json()
    const { reason, description, evidenceAssetIds } = rejectSchema.parse(body)
    const svc = getReturnService()
    const updated = await svc.rejectReceiptBySeller({
      returnRequestId,
      sellerId,
      reason,
      ...(description !== undefined ? { description } : {}),
      ...(evidenceAssetIds !== undefined ? { evidenceAssetIds } : {}),
    })
    return ok(updated)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/admin/returns — admin tüm iadeleri listeler
export async function listReturnsForAdmin(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const status = url.searchParams.get('status') as never
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const svc = getReturnService()
    const returns = await svc.listForAdmin({ status, skip, take })
    return ok(returns)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/returns/:id/review — admin onaylar/reddeder
export async function reviewReturnRequest(
  req: NextRequest,
  returnRequestId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const { decision, reviewNote } = reviewSchema.parse(body)
    const svc = getReturnService()
    const updated = await svc.reviewRequest({
      returnRequestId,
      adminActorId,
      decision,
      ...(reviewNote !== undefined ? { reviewNote } : {}),
    })
    return ok(updated)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/returns/:id/mark-received — ürün alındı, iade tamamlandı
export async function markReturnReceived(
  req: NextRequest,
  returnRequestId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const { refundAmount } = markReceivedSchema.parse(body)
    const { Decimal } = await import('@prisma/client/runtime/client')
    const svc = getReturnService()
    const updated = await svc.markItemReceived({
      returnRequestId,
      adminActorId,
      refundAmount: new Decimal(refundAmount),
    })
    return ok(updated)
  } catch (err) {
    return handleError(err)
  }
}
