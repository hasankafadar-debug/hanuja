/**
 * Dispute route handlers — thin: validate → auth → service → respond.
 * Business logic lives in api/services/dispute.service.ts, not here.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, created, handleError } from '../lib/response'
import { createDisputeService } from '../services/dispute.service'
import { createPrismaForRoute } from '../lib/prisma'
import type { DisputeViewer } from '../lib/dispute-authorization'

const openDisputeSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(3, 'Sebep en az 3 karakter olmalı'),
  description: z.string().optional(),
})

const resolveDisputeSchema = z.object({
  resolutionType: z.enum(['resolved_for_customer', 'resolved_for_seller']),
  resolution: z.string().min(5, 'Çözüm açıklaması en az 5 karakter olmalı'),
  refundAmount: z.number().positive().optional(),
})

const addMessageSchema = z.object({
  body: z.string().min(1, 'Mesaj boş olamaz'),
})

function getDisputeService() {
  const prisma = createPrismaForRoute()
  return createDisputeService({ prisma })
}

// POST /api/disputes — müşteri uyuşmazlık açar
export async function openDispute(req: NextRequest, customerId: string) {
  try {
    const body = await req.json()
    const { orderId, reason, description } = openDisputeSchema.parse(body)
    const svc = getDisputeService()
    const dispute = await svc.openDispute({
      orderId,
      customerId,
      reason,
      ...(description !== undefined ? { description } : {}),
    })
    return created(dispute)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/disputes/:id — uyuşmazlık detayı (mesajlar dahil)
export async function getDispute(disputeId: string, viewer: DisputeViewer) {
  try {
    const svc = getDisputeService()
    const dispute = await svc.getDispute(disputeId, viewer)
    return ok(dispute)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/disputes/:id/messages — mesaj ekle
export async function addDisputeMessage(
  req: NextRequest,
  disputeId: string,
  viewer: DisputeViewer,
) {
  try {
    const body = await req.json()
    const { body: messageBody } = addMessageSchema.parse(body)
    const svc = getDisputeService()
    const message = await svc.addMessage({
      disputeId,
      viewer,
      body: messageBody,
    })
    return created(message)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/admin/disputes — admin tüm uyuşmazlıkları listeler
export async function listDisputesForAdmin(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const status = url.searchParams.get('status') as never
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const svc = getDisputeService()
    const list = await svc.listForAdmin({ status, skip, take })
    return ok(list)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/disputes/:id/resolve — admin çözer
export async function resolveDispute(req: NextRequest, disputeId: string, adminActorId: string) {
  try {
    const body = await req.json()
    const { resolutionType, resolution, refundAmount } = resolveDisputeSchema.parse(body)

    let refundDecimal: import('@prisma/client/runtime/client').Decimal | undefined
    if (refundAmount !== undefined) {
      const { Decimal } = await import('@prisma/client/runtime/client')
      refundDecimal = new Decimal(refundAmount)
    }

    const svc = getDisputeService()
    const resolved = await svc.resolveDispute({
      disputeId,
      adminActorId,
      resolutionType,
      resolution,
      ...(refundDecimal !== undefined ? { refundAmount: refundDecimal } : {}),
    })
    return ok(resolved)
  } catch (err) {
    return handleError(err)
  }
}
