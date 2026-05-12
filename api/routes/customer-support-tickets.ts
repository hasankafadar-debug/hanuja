/**
 * Customer support ticket route handlers — müşteri-admin destek sistemi.
 * Thin HTTP wrappers around createCustomerSupportTicketService.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, created, handleError } from '../lib/response'
import { createCustomerSupportTicketService } from '../services/customer-support-ticket.service'
import { createPrismaForRoute } from '../lib/prisma'

function getSvc() {
  return createCustomerSupportTicketService({ prisma: createPrismaForRoute() })
}

const createTicketSchema = z.object({
  category: z.enum([
    'shipping_delay',
    'damaged_product',
    'wrong_product',
    'invoice_issue',
    'payment_issue',
    'return_or_exchange',
    'other',
  ]),
  subject: z.string().min(3).max(120),
  body: z.string().min(5).max(4000),
  attachmentAssetIds: z.array(z.string()).max(5).optional(),
})

const replySchema = z.object({
  body: z.string().min(2).max(4000),
  attachmentAssetIds: z.array(z.string()).max(5).optional(),
})

// POST /api/orders/:orderId/support-tickets
export async function createSupportTicket(
  req: NextRequest,
  orderId: string,
  customerId: string,
) {
  try {
    const body = await req.json()
    const parsed = createTicketSchema.parse(body)
    const svc = getSvc()
    const ticket = await svc.createForCustomer({
      customerId,
      orderId,
      category: parsed.category,
      subject: parsed.subject,
      body: parsed.body,
      ...(parsed.attachmentAssetIds ? { attachmentAssetIds: parsed.attachmentAssetIds } : {}),
    })
    return created(ticket)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/orders/:orderId/support-tickets
export async function listSupportTicketsForOrder(
  orderId: string,
  customerId: string,
) {
  try {
    const svc = getSvc()
    const tickets = await svc.listForCustomer(customerId, orderId)
    return ok({ tickets })
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/support-tickets/:id
export async function getSupportTicket(ticketId: string, customerId: string) {
  try {
    const svc = getSvc()
    const ticket = await svc.getByIdForCustomer(ticketId, customerId)
    return ok({ ticket })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/support-tickets/:id/messages
export async function replySupportTicket(
  req: NextRequest,
  ticketId: string,
  customerId: string,
) {
  try {
    const body = await req.json()
    const parsed = replySchema.parse(body)
    const svc = getSvc()
    const message = await svc.replyAsCustomer({
      ticketId,
      customerId,
      body: parsed.body,
      ...(parsed.attachmentAssetIds ? { attachmentAssetIds: parsed.attachmentAssetIds } : {}),
    })
    return created(message)
  } catch (err) {
    return handleError(err)
  }
}

// --- Admin handlers ---

const adminReplySchema = z.object({
  body: z.string().min(2).max(4000),
  attachmentAssetIds: z.array(z.string()).max(5).optional(),
})

const resolveSchema = z.object({
  note: z.string().max(500).optional(),
})

// GET /api/admin/customer-support-tickets
export async function adminListSupportTickets(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const rawStatus = url.searchParams.get('status')
    const take = Math.min(parseInt(url.searchParams.get('take') ?? '50'), 100)
    const skip = parseInt(url.searchParams.get('skip') ?? '0')

    const statusValues = [
      'waiting_for_admin',
      'waiting_for_customer',
      'resolved',
    ] as const
    const status = statusValues.includes(rawStatus as (typeof statusValues)[number])
      ? (rawStatus as (typeof statusValues)[number])
      : undefined

    const svc = getSvc()
    const result = await svc.listForAdmin({ take, skip, ...(status ? { status } : {}) })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/admin/customer-support-tickets/:id
export async function adminGetSupportTicket(ticketId: string) {
  try {
    const svc = getSvc()
    const ticket = await svc.getByIdForAdmin(ticketId)
    return ok({ ticket })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/customer-support-tickets/:id/messages
export async function adminReplySupportTicket(
  req: NextRequest,
  ticketId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const parsed = adminReplySchema.parse(body)
    const svc = getSvc()
    const message = await svc.replyAsAdmin({
      ticketId,
      adminActorId,
      body: parsed.body,
      ...(parsed.attachmentAssetIds ? { attachmentAssetIds: parsed.attachmentAssetIds } : {}),
    })
    return created(message)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/customer-support-tickets/:id/resolve
export async function adminResolveSupportTicket(
  req: NextRequest,
  ticketId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const parsed = resolveSchema.parse(body)
    const svc = getSvc()
    const ticket = await svc.resolveByAdmin({
      ticketId,
      adminActorId,
      ...(parsed.note ? { note: parsed.note } : {}),
    })
    return ok({ ticket })
  } catch (err) {
    return handleError(err)
  }
}
