import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { saveManagedCategory } from '@hanuja/api/services/catalog-admin.service'

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  templateCode: z.string().nullable().optional(),
  preview: z.boolean().optional(),
  confirmationToken: z.string().optional(),
})
async function actor() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()
  if (session.user.role !== 'admin') throw new ForbiddenError()
  return session.user.id
}
export async function GET() {
  try {
    await actor()
    const db = createPrismaForRoute()
    return ok({
      categories: await db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    })
  } catch (error) {
    return handleError(error)
  }
}
export async function POST(req: NextRequest) {
  try {
    const csrf = checkCsrf(req)
    if (csrf) return csrf
    const id = await actor()
    const input = schema.parse(await req.json())
    return ok(await saveManagedCategory(createPrismaForRoute(), id, input))
  } catch (error) {
    return handleError(error)
  }
}
