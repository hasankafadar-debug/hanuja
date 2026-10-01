import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { sendEmail } from '@hanuja/api/lib/mailer'
import { escapeHtml } from '@hanuja/api/lib/email-templates/shared'
import { checkUserRateLimit, HIGH_RISK_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { sellerBankOtpIdentifier, sellerBankOtpValue } from '@hanuja/api/lib/seller-bank-otp'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }
  if (session.user.role !== 'seller' || session.user.mustChangePassword) {
    return NextResponse.json({ error: 'Satıcı doğrulaması gerekli.' }, { status: 403 })
  }

  // OTP e-posta bombardımanını ve deneme hızını sınırla
  const rl = await checkUserRateLimit(
    session.user.id,
    'bank-details:otp-request',
    HIGH_RISK_RATE_LIMIT,
  )
  if (!rl.allowed) return rl.response!

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    include: { user: { select: { email: true, name: true } } },
  })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  if (seller.status !== 'active') {
    return NextResponse.json(
      { error: 'Banka bilgisi yalnızca aktif satıcı hesabında değiştirilebilir.' },
      { status: 403 },
    )
  }

  const code = String(randomInt(100000, 999999))
  const identifier = sellerBankOtpIdentifier(seller.id, session.user.id)

  await prisma.verification.deleteMany({ where: { identifier } })
  await prisma.verification.create({
    data: {
      identifier,
      value: sellerBankOtpValue(identifier, code),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })

  await sendEmail({
    to: seller.user.email,
    subject: 'Hanuja banka değişikliği doğrulama kodu',
    html: `<p>Merhaba ${escapeHtml(seller.user.name ?? seller.displayName)},</p><p>Banka bilgisi değişikliği için doğrulama kodunuz: <strong>${code}</strong></p><p>Bu kod 10 dakika geçerlidir.</p>`,
    text: `Banka bilgisi değişikliği için doğrulama kodunuz: ${code}. Kod 10 dakika geçerlidir.`,
  })

  return NextResponse.json({
    success: true,
    message: 'Doğrulama kodu e-posta adresinize gönderildi.',
  })
}
