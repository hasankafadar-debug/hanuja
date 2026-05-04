import { headers } from 'next/headers'
import { type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

const PAGE_SIZE = 20

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    const { searchParams } = req.nextUrl
    const kind = searchParams.get('kind') // 'image' | 'video' | 'document' | null
    const folder = searchParams.get('folder') // 'slider' | 'promo' | 'blog' | 'general' | null
    const search = searchParams.get('search') ?? ''
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))

    const prisma = createPrismaForRoute()

    const where = {
      ...(kind ? { kind: kind as 'image' | 'video' | 'document' } : {}),
      ...(folder && folder !== 'all' ? { folder } : {}),
      ...(search ? { originalName: { contains: search, mode: 'insensitive' as const } } : {}),
      status: 'ready',
    }

    const [assets, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          kind: true,
          url: true,
          folder: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          width: true,
          height: true,
          durationSec: true,
          variants: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.mediaAsset.count({ where }),
    ])

    return ok({
      assets,
      total,
      page,
      totalPages: Math.ceil(total / PAGE_SIZE),
    })
  } catch (err) {
    return handleError(err)
  }
}
