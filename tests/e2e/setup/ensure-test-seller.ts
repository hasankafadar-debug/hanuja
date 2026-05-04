/**
 * Playwright E2E setup: test satıcısı oluşturur/günceller.
 * E-posta doğrulamasını atlatmak için doğrudan DB'ye yazar.
 *
 * Çalıştırma: pnpm exec tsx tests/e2e/setup/ensure-test-seller.ts
 */

import { PrismaClient, UserRole, SellerStatus } from '@prisma/client'
import { randomBytes, scrypt } from 'node:crypto'

export const TEST_SELLER_EMAIL = 'test-seller@hanuja.test'
export const TEST_SELLER_PASSWORD = 'SellerPassword123!'
export const TEST_SELLER_NAME = 'Test Satıcı'

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

  try {
    // 1. Kullanıcıyı oluştur veya güncelle
    const existing = await prisma.user.findFirst({ where: { email: TEST_SELLER_EMAIL } })
    let userId: string

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { emailVerified: true, role: UserRole.seller, name: TEST_SELLER_NAME },
      })
      userId = existing.id
      console.log(`✏️  Mevcut kullanıcı güncellendi: ${TEST_SELLER_EMAIL}`)
    } else {
      const created = await prisma.user.create({
        data: {
          email: TEST_SELLER_EMAIL,
          name: TEST_SELLER_NAME,
          emailVerified: true,
          role: UserRole.seller,
        },
      })
      userId = created.id
      console.log(`➕ Yeni kullanıcı oluşturuldu: ${TEST_SELLER_EMAIL}`)
    }

    // 2. Şifreyi Better Auth'un scrypt formatıyla kaydet
    const hashedPassword = await hashPasswordBetterAuth(TEST_SELLER_PASSWORD)

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

    // 3. Seller kaydı oluştur veya güncelle (User → Seller → SellerProfile)
    const existingSeller = await prisma.seller.findFirst({ where: { userId } })
    let sellerId: string

    if (existingSeller) {
      await prisma.seller.update({
        where: { id: existingSeller.id },
        data: { status: SellerStatus.active },
      })
      sellerId = existingSeller.id
      console.log('🏪 Seller kaydı güncellendi (approved)')
    } else {
      const createdSeller = await prisma.seller.create({
        data: {
          userId,
          slug: 'test-magaza-e2e',
          displayName: 'Test Mağaza E2E',
          status: SellerStatus.active,
        },
      })
      sellerId = createdSeller.id
      console.log('🏪 Seller kaydı oluşturuldu')
    }

    // 4. SellerProfile oluştur (yoksa)
    const existingProfile = await prisma.sellerProfile.findFirst({ where: { sellerId } })
    if (!existingProfile) {
      await prisma.sellerProfile.create({
        data: {
          sellerId,
          companyName: 'Test Şirketi A.Ş.',
          phone: '05001234999',
          taxNumber: '1234567890',
          legalAddress: 'Test Mahallesi, E2E Sokak No:1, İstanbul',
          isVerified: true,
        },
      })
      console.log('📋 SellerProfile oluşturuldu')
    }

    console.log(`\n✅ Test satıcı hazır`)
    console.log(`   E-posta : ${TEST_SELLER_EMAIL}`)
    console.log(`   Şifre   : ${TEST_SELLER_PASSWORD}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('❌ ensure-test-seller hatası:', err)
  process.exit(1)
})
