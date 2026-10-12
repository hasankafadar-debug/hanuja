import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createProductQuestionService } from '@hanuja/api/services/product-question.service'
import { created, handleError } from '@hanuja/api/lib/response'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getAdminSession()
    const { id } = await params
    const body = z.object({ audience: z.enum(['customer', 'seller']), body: z.string().min(2).max(2000) }).parse(await req.json())
    return created(await createProductQuestionService({ prisma: createPrismaForRoute() }).replyAsAdmin({ threadId: id, adminId: session.user.id, ...body }))
  } catch (error) { return handleError(error) }
}
