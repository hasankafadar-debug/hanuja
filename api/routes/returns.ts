/**
 * Return route handlers — thin: validate → auth → service → respond.
 * Business logic lives in api/services/return.service.ts, not here.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, created, handleError } from '../lib/response'
import { UnauthorizedError } from '../lib/errors'
import { createReturnService } from '../services/return.service'
import { createPrismaForRoute } from '../lib/prisma'

const openRequestSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(3, 'Sebep en az 3 karakter olmalı'),
  description: z.string().optional(),
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
})

function getReturnService() {
  const prisma = createPrismaForRoute()
  return createReturnService({ prisma })
}

// POST /api/returns — müşteri iade talebi açar
export async function openReturnRequest(req: NextRequest, customerId: string) {
  try {
    const body = await req.json()
    const { orderId, reason, description } = openRequestSchema.parse(body)
    const svc = getReturnService()
    const returnRequest = await svc.openRequest({ orderId, customerId, reason, ...(description !== undefined ? { description } : {}) })
    return created(returnRequest)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/returns/:id — iade detayı
export async function getReturnRequest(returnRequestId: string) {
  try {
    const svc = getReturnService()
    const returnRequest = await svc.getRequest(returnRequestId)
    return ok(returnRequest)
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
    const { body: messageBody } = addMessageSchema.parse(body)
    const svc = getReturnService()
    const message = await svc.addMessage({
      returnRequestId,
      authorId,
      authorRole,
      body: messageBody,
    })
    return created(message)
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
    const updated = await svc.reviewRequest({ returnRequestId, adminActorId, decision, ...(reviewNote !== undefined ? { reviewNote } : {}) })
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
