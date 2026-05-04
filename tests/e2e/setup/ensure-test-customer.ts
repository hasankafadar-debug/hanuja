/**
 * Playwright E2E setup: test müşterisi oluşturur/günceller.
 * beforeAll'dan execSync ile çağrılır; e-posta doğrulamasını atlatmak için
 * doğrudan DB'ye yazar.
 *
 * Şifre hash'i Better Auth'un node.js scrypt formatına göre üretilir:
 *   randomHex16Salt:scryptHash(N=16384,r=16,p=1,dkLen=64)
 *
 * Çalıştırma: pnpm exec tsx tests/e2e/setup/ensure-test-customer.ts
 */

import { PrismaClient, UserRole } from '@prisma/client'
import { randomBytes, scrypt } from 'node:crypto'

export const TEST_EMAIL = 'playwright-eft@hanuja.test'
export const TEST_PASSWORD = 'PlaywrightEFT1234!'
export const TEST_NAME = 'Playwright Müşteri'

function hashPasswordBetterAuth(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex')
    scrypt(
      password.normalize('NFKC'),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, key) => {
        if (err) reject(err)
        else resolve(`${salt}:${key.toString('hex')}`)
      },
    )
  })
}

async function main() {
  const prisma = new PrismaClient()

  // 1. Create or update test user (emailVerified = true to skip email flow)
  const existing = await prisma.user.findFirst({ where: { email: TEST_EMAIL } })
  let userId: string

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { emailVerified: true, role: UserRole.customer, name: TEST_NAME },
    })
    userId = existing.id
  } else {
    const created = await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        name: TEST_NAME,
        emailVerified: true,
        role: UserRole.customer,
      },
    })
    userId = created.id
  }

  // 2. Set password directly in the account table using Better Auth's scrypt format
  const hashedPassword = await hashPasswordBetterAuth(TEST_PASSWORD)

  const existingAccount = await prisma.account.findFirst({
    where: { userId, providerId: 'credential' },
  })

  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { password: hashedPassword },
    })
  } else {
    await prisma.account.create({
      data: {
        userId,
        providerId: 'credential',
        accountId: userId,
        password: hashedPassword,
      },
    })
  }

  // 3. Ensure the user has at least one address (needed for checkout)
  const existingAddr = await prisma.address.findFirst({ where: { userId } })
  if (!existingAddr) {
    await prisma.address.create({
      data: {
        userId,
        fullName: TEST_NAME,
        phone: '05001234567',
        addressLine1: 'Playwright Mahallesi, Test Sokak No:1',
        district: 'Kadıköy',
        city: 'İstanbul',
        postalCode: '34000',
        isDefault: true,
      },
    })
  }

  // 4. Clear any leftover cart state so repeat E2E runs stay deterministic
  await prisma.cartItem.deleteMany({
    where: { cart: { userId } },
  })

  await prisma.$disconnect()
  console.log(`✅ Test müşteri hazır: ${TEST_EMAIL}`)
}

main().catch((err) => {
  console.error('❌ ensure-test-customer hatası:', err)
  process.exit(1)
})
