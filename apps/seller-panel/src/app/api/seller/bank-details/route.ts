import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'
import { createSellerService } from '@hanuja/api/services/seller.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const bankDetailSchema = z.object({
  iban: z
    .string()
    .min(10, 'Geçerli bir IBAN giriniz')
    .max(34)
    .regex(/^TR/, 'IBAN TR ile başlamalıdır'),
  accountHolder: z.string().min(2, 'Hesap sahibi adı zorunludur').max(100),
  bankName: z.string().min(2, 'Banka adı zorunludur').max(80),
})

/**
 * POST /api/seller/bank-details — banka bilgisi değişiklik talebi oluştur.
 * Yeni kayıt isActive=false olarak eklenir; admin onayı gerektirir.
 * Her değişiklik audit log'a yazılır.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = bankDetailSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Geçersiz veri.' }, { status: 400 })
  }

  const svc = createSellerService({ prisma })
  await svc.updateBankDetails(seller.id, {
    ...parsed.data,
    actorId: session.user.id,
    actorRole: 'seller',
  })

  return NextResponse.json({
    success: true,
    message: 'Banka bilgisi değişiklik talebiniz alındı. Admin incelemesi sonrası aktif edilecektir.',
  })
}
