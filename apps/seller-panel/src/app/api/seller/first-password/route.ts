import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkUserRateLimit, HIGH_RISK_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { sellerPasswordSchema } from '@hanuja/security/password-policy'
import { PrismaClient } from '@prisma/client'
import { revokeTrustedDevices } from '@hanuja/api/lib/auth-security'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const bodySchema = z.object({
  newPassword: sellerPasswordSchema,
})

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ message: 'Yetkisiz.' }, { status: 401 })
  }

  const rl = await checkUserRateLimit(session.user.id, 'first-password', HIGH_RISK_RATE_LIMIT)
  if (!rl.allowed) return rl.response!

  const body = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!body.success) {
    return NextResponse.json({ message: body.error.errors[0]?.message ?? 'Geçersiz veri.' }, { status: 400 })
  }

  await auth.api.setPassword({
    headers: await headers(),
    body: { newPassword: body.data.newPassword },
  })
  await revokeTrustedDevices(prisma, session.user.id)

  await prisma.user.update({
    where: { id: session.user.id },
    data: { mustChangePassword: false },
  })

  return NextResponse.json({ success: true })
}
