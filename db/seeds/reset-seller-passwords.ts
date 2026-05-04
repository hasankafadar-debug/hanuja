import { PrismaClient } from '@prisma/client'
import { createAuth } from '../../api/lib/auth'

const prisma = new PrismaClient()

async function resetPasswordFor(email: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.warn(`! Kullanıcı bulunamadı: ${email}`)
    return
  }

  const auth = createAuth({
    baseURL: 'http://localhost:3001',
    secret: process.env.BETTER_AUTH_SECRET ?? 'change-me-in-production',
    prisma,
    trustedOrigins: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],
  })

  const token = `reset-seller-${user.id}-${Date.now()}`
  await prisma.verification.deleteMany({ where: { identifier: `reset-password:${token}` } })
  await prisma.verification.create({
    data: {
      identifier: `reset-password:${token}`,
      value: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    },
  })
  await auth.api.resetPassword({ body: { token, newPassword } })
  console.log(`✓ ${email} şifresi güncellendi`)
}

async function main() {
  await resetPasswordFor('satici@atelyenoa.com', 'Seller1234!')
  await resetPasswordFor('satici@woodform.com', 'Seller1234!')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
