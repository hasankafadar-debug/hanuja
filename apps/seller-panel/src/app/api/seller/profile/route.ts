import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'
import { createSellerService } from '@hanuja/api/services/seller.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const profileSchema = z.object({
  storeName: z.string().min(2, 'Mağaza adı en az 2 karakter olmalı').max(80).optional(),
  bio: z.string().max(1000).optional(),
  phone: z.string().max(20).optional(),
})

/** PATCH /api/seller/profile — mağaza profili güncelle */
export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = profileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Geçersiz veri.' }, { status: 400 })
  }

  const { storeName, bio, phone } = parsed.data
  const svc = createSellerService({ prisma })
  await svc.updateProfile(seller.id, session.user.id, {
    ...(storeName !== undefined ? { storeName } : {}),
    ...(bio !== undefined ? { bio } : {}),
    ...(phone !== undefined ? { phone } : {}),
  })

  return NextResponse.json({ success: true })
}
