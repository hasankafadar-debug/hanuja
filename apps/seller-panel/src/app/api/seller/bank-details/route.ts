import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkUserRateLimit, HIGH_RISK_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { createSellerBankService } from '@hanuja/api/services/seller-bank.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const bankDetailSchema = z.object({
  iban: z
    .string()
    .trim()
    .regex(/^TR\d{24}$/, 'Geçerli bir TR IBAN giriniz'),
  accountHolder: z.string().trim().min(2, 'Hesap sahibi adı zorunludur').max(100),
  bankName: z.string().trim().min(2, 'Banka adı zorunludur').max(80),
  otpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, '6 haneli doğrulama kodu giriniz'),
  reason: z.string().trim().max(200).optional(),
})

function buildOtpIdentifier(sellerId: string, userId: string) {
  return `seller-bank-detail:${sellerId}:${userId}`
}

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  // IBAN değişikliği payout-kritik: deneme hızını agresif sınırla (OTP brute-force dahil)
  const rl = await checkUserRateLimit(session.user.id, 'bank-details:change', HIGH_RISK_RATE_LIMIT)
  if (!rl.allowed) return rl.response!

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  if (seller.status !== 'active') {
    return NextResponse.json(
      { error: 'Banka bilgisi yalnızca aktif satıcı hesabında değiştirilebilir.' },
      { status: 403 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const parsed = bankDetailSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Geçersiz veri.' },
      { status: 400 },
    )
  }

  const verification = await prisma.verification.findFirst({
    where: {
      identifier: buildOtpIdentifier(seller.id, session.user.id),
      value: parsed.data.otpCode,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!verification) {
    return NextResponse.json(
      { error: 'Doğrulama kodu geçersiz veya süresi dolmuş.' },
      { status: 400 },
    )
  }

  try {
    const service = createSellerBankService({ prisma })
    const forwardedFor = req.headers.get('x-forwarded-for')
    await service.requestChange({
      sellerId: seller.id,
      actorId: session.user.id,
      iban: parsed.data.iban.replace(/\s+/g, ''),
      accountHolder: parsed.data.accountHolder,
      bankName: parsed.data.bankName,
      ip: forwardedFor?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
      reason: parsed.data.reason ?? null,
    })

    await prisma.verification.delete({ where: { id: verification.id } })

    return NextResponse.json({
      success: true,
      message:
        'Banka bilgisi değişiklik talebiniz alındı. Yeni IBAN 24 saat sonunda aktif olacaktır.',
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Banka bilgisi kaydedilemedi.' },
      { status: 400 },
    )
  }
}
