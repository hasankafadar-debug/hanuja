import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createStoreFollowService } from '@hanuja/api/services/store-follow.service'

interface RouteContext {
  params: Promise<{ sellerId: string }>
}

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

export async function GET(_req: Request, { params }: RouteContext) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { sellerId } = await params
  const service = createStoreFollowService({ prisma: createPrismaForRoute() })
  const isFollowing = await service.isFollowingStore(userId, sellerId)

  return NextResponse.json({ data: { isFollowing } })
}

export async function POST(_req: Request, { params }: RouteContext) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { sellerId } = await params
  const service = createStoreFollowService({ prisma: createPrismaForRoute() })
  await service.followStore(userId, sellerId)

  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { sellerId } = await params
  const service = createStoreFollowService({ prisma: createPrismaForRoute() })
  await service.unfollowStore(userId, sellerId)

  return NextResponse.json({ ok: true })
}
