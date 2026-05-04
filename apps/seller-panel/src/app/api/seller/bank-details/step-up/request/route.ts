import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { sendEmail } from '@hanuja/api/lib/mailer'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

function buildOtpIdentifier(sellerId: string, userId: string) {
  return `seller-bank-detail:${sellerId}:${userId}`
}

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    include: { user: { select: { email: true, name: true } } },
  })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  const code = String(randomInt(100000, 999999))
  const identifier = buildOtpIdentifier(seller.id, session.user.id)

  await prisma.verification.deleteMany({ where: { identifier } })
  await prisma.verification.create({
    data: {
      identifier,
      value: code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })

  await sendEmail({
    to: seller.user.email,
    subject: 'Hanuja banka değişikliği doğrulama kodu',
    html: `<p>Merhaba ${seller.user.name ?? seller.displayName},</p><p>Banka bilgisi değişikliği için doğrulama kodunuz: <strong>${code}</strong></p><p>Bu kod 10 dakika geçerlidir.</p>`,
    text: `Banka bilgisi değişikliği için doğrulama kodunuz: ${code}. Kod 10 dakika geçerlidir.`,
  })

  return NextResponse.json({ success: true, message: 'Doğrulama kodu e-posta adresinize gönderildi.' })
}
