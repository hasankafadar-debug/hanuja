import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError, ValidationError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { listAdminMedia, type AdminMediaSource } from '@hanuja/api/services/admin-media.service'

const PAGE_SIZE = 20
const VALID_KINDS = new Set(['image', 'video', 'document'])
const VALID_SOURCES = new Set<AdminMediaSource>(['admin', 'seller-products'])

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { searchParams } = req.nextUrl
    const source = searchParams.get('source') ?? 'admin'
    const kind = searchParams.get('kind') // 'image' | 'video' | 'document' | null
    const folder = searchParams.get('folder') // 'slider' | 'promo' | 'blog' | 'general' | null
    const search = searchParams.get('search') ?? ''
    const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10)
    const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1

    if (!VALID_SOURCES.has(source as AdminMediaSource)) {
      throw new ValidationError('Geçersiz medya kaynağı.')
    }
    if (kind && !VALID_KINDS.has(kind)) {
      throw new ValidationError('Geçersiz medya türü.')
    }

    return ok(
      await listAdminMedia(createPrismaForRoute(), session.user.id, {
        source: source as AdminMediaSource,
        page,
        pageSize: PAGE_SIZE,
        ...(kind ? { kind: kind as 'image' | 'video' | 'document' } : {}),
        ...(folder ? { folder } : {}),
        ...(search ? { search } : {}),
      }),
    )
  } catch (err) {
    return handleError(err)
  }
}
