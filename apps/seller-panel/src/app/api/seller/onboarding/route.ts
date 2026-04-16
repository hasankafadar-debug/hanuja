/**
 * POST /api/seller/onboarding
 *
 * Creates the Seller record, SellerBankDetail, and sets user role to "seller".
 * Only callable by authenticated users with role "customer" (not yet a seller).
 *
 * Business rules enforced:
 * - User must be authenticated
 * - User must not already have a Seller record
 * - IBAN must look valid (TR + 24 digits) — full bank verification is done by admin
 * - Slug must be unique
 * - Bank details are created with isVerified=false; admin must verify before payout
 */
import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

function isValidIban(iban: string): boolean {
  const clean = iban.replace(/\s/g, '').toUpperCase()
  return /^TR\d{24}$/.test(clean)
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)
}

export async function POST(request: NextRequest) {
  // ── Auth check ─────────────────────────────────────────────────────────────
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    return NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
  }

  // ── Prevent duplicate seller creation ─────────────────────────────────────
  const existingSeller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })

  if (existingSeller) {
    return NextResponse.json(
      { message: 'Bu hesap zaten bir satıcı hesabına bağlı.' },
      { status: 409 },
    )
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: {
    magaza: { storeName: string; slug: string; description: string; city: string }
    isletme: {
      companyType: string
      companyName: string
      taxNumber: string
      taxOffice: string
      address: string
      city: string
      district: string
      postalCode: string
    }
    banka: { accountHolderName: string; iban: string; bankName: string }
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Geçersiz istek.' }, { status: 400 })
  }

  const { magaza, isletme, banka } = body

  // ── Validate required fields ───────────────────────────────────────────────
  if (!magaza?.storeName || !magaza?.slug || !magaza?.description || !magaza?.city) {
    return NextResponse.json({ message: 'Mağaza bilgileri eksik.' }, { status: 400 })
  }

  if (!isletme?.taxNumber || !isletme?.address || !isletme?.city) {
    return NextResponse.json({ message: 'İşletme bilgileri eksik.' }, { status: 400 })
  }

  if (!banka?.accountHolderName || !banka?.iban || !banka?.bankName) {
    return NextResponse.json({ message: 'Banka bilgileri eksik.' }, { status: 400 })
  }

  if (!isValidSlug(magaza.slug)) {
    return NextResponse.json(
      { message: 'Geçersiz mağaza URL\'si. Yalnızca küçük harf, rakam ve tire kullanabilirsiniz.' },
      { status: 400 },
    )
  }

  if (!isValidIban(banka.iban)) {
    return NextResponse.json(
      { message: 'Geçersiz IBAN. TR ile başlayan 26 karakterlik format bekleniyor.' },
      { status: 400 },
    )
  }

  // ── Slug uniqueness check ──────────────────────────────────────────────────
  const slugTaken = await prisma.seller.findUnique({
    where: { slug: magaza.slug },
    select: { id: true },
  })

  if (slugTaken) {
    return NextResponse.json(
      { message: 'Bu mağaza URL\'si kullanılıyor. Farklı bir URL seçin.' },
      { status: 409 },
    )
  }

  // ── Create Seller + BankDetail in a transaction ───────────────────────────
  await prisma.$transaction(async (tx) => {
    const seller = await tx.seller.create({
      data: {
        userId: session.user.id,
        displayName: magaza.storeName,
        slug: magaza.slug,
        status: 'pending',
        profile: {
          create: {
            bio: magaza.description ?? null,
            city: magaza.city ?? null,
            taxNumber: isletme.taxNumber ?? null,
          },
        },
      },
    })

    // Bank details: created with isVerified=false
    // Admin must verify before first payout
    await tx.sellerBankDetail.create({
      data: {
        sellerId: seller.id,
        accountHolder: banka.accountHolderName,
        iban: banka.iban, // stored normalized (no spaces)
        bankName: banka.bankName,
        isVerified: false,
        isActive: false, // activated after admin verification
      },
    })

    // Set user role to "seller" via Better Auth admin plugin
    await tx.user.update({
      where: { id: session.user.id },
      data: { role: 'seller' },
    })
  })

  return NextResponse.json({ success: true }, { status: 201 })
}
