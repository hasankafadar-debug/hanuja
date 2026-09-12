/**
 * Idempotent fixture for the admin seller navigation E2E tests.
 *
 * Run only with an explicit, isolated DATABASE_URL:
 *   pnpm exec tsx tests/e2e/setup/ensure-test-admin-navigation.ts
 */

import { randomBytes, scrypt } from 'node:crypto'
import { PrismaClient, SellerStatus, UserRole } from '@prisma/client'
import { assertAdminNavigationTestDatabase } from './admin-navigation-database-guard'

export const TEST_ADMIN_EMAIL = 'test-admin@hanuja.test'
export const TEST_ADMIN_PASSWORD = 'AdminPassword123!'
export const TEST_SELLER_EMAIL = 'navigation-seller@hanuja.test'
export const TEST_SELLER_NAME = 'Gezinme Test Mağazası'

function hashPasswordBetterAuth(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex')
    scrypt(
      password.normalize('NFKC'),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (error, key) => {
        if (error) reject(error)
        else resolve(`${salt}:${key.toString('hex')}`)
      },
    )
  })
}

async function ensureCredentialAccount(
  prisma: PrismaClient,
  userId: string,
  hashedPassword: string,
) {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: 'credential' },
  })

  if (account) {
    await prisma.account.update({
      where: { id: account.id },
      data: { accountId: userId, password: hashedPassword },
    })
    return
  }

  await prisma.account.create({
    data: {
      accountId: userId,
      providerId: 'credential',
      userId,
      password: hashedPassword,
    },
  })
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  assertAdminNavigationTestDatabase(databaseUrl)

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const admin = await prisma.user.upsert({
      where: { email: TEST_ADMIN_EMAIL },
      update: {
        name: 'Navigation Test Admin',
        emailVerified: true,
        role: UserRole.admin,
        twoFactorEnabled: false,
        mustChangePassword: false,
        banned: false,
        banReason: null,
        banExpires: null,
      },
      create: {
        id: 'user_admin_navigation_test',
        email: TEST_ADMIN_EMAIL,
        name: 'Navigation Test Admin',
        emailVerified: true,
        role: UserRole.admin,
      },
    })
    await ensureCredentialAccount(
      prisma,
      admin.id,
      await hashPasswordBetterAuth(TEST_ADMIN_PASSWORD),
    )

    const sellerUser = await prisma.user.upsert({
      where: { email: TEST_SELLER_EMAIL },
      update: {
        name: TEST_SELLER_NAME,
        emailVerified: true,
        role: UserRole.seller,
        banned: false,
        banReason: null,
        banExpires: null,
      },
      create: {
        id: 'user_seller_navigation_test',
        email: TEST_SELLER_EMAIL,
        name: TEST_SELLER_NAME,
        emailVerified: true,
        role: UserRole.seller,
      },
    })

    const seller = await prisma.seller.upsert({
      where: { userId: sellerUser.id },
      update: {
        slug: 'navigation-test-magazasi',
        displayName: TEST_SELLER_NAME,
        status: SellerStatus.active,
      },
      create: {
        id: 'seller_navigation_test',
        userId: sellerUser.id,
        slug: 'navigation-test-magazasi',
        displayName: TEST_SELLER_NAME,
        status: SellerStatus.active,
      },
    })

    await prisma.sellerProfile.upsert({
      where: { sellerId: seller.id },
      update: {
        companyName: 'Gezinme Test Şirketi',
        city: 'İstanbul',
        legalAddress: 'Test Mahallesi, Gezinme Sokak No:1',
        phone: '05000000000',
        taxNumber: '0000000000',
        isVerified: true,
      },
      create: {
        id: 'seller_profile_navigation_test',
        sellerId: seller.id,
        companyName: 'Gezinme Test Şirketi',
        city: 'İstanbul',
        legalAddress: 'Test Mahallesi, Gezinme Sokak No:1',
        phone: '05000000000',
        taxNumber: '0000000000',
        isVerified: true,
      },
    })

    await prisma.platformSettings.upsert({
      where: { id: 'platform' },
      update: {},
      create: { id: 'platform' },
    })

    console.log('Admin navigation test fixture is ready.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(
    'ensure-test-admin-navigation failed:',
    error instanceof Error ? error.message : 'Unknown error',
  )
  process.exitCode = 1
})
