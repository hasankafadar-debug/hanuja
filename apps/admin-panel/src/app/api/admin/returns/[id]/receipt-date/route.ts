import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { recordReturnCarrierReceipt } from '@hanuja/api/services/return-deadline.service'
import { ok, handleError } from '@hanuja/api/lib/response'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getAdminSession()
    const { id } = await params
    const { receivedAt } = z.object({ receivedAt: z.string().datetime() }).parse(await req.json())
    return ok(await recordReturnCarrierReceipt(createPrismaForRoute(), id, new Date(receivedAt), session.user.id))
  } catch (error) { return handleError(error) }
}
