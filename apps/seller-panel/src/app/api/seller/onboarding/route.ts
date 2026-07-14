/**
 * POST /api/seller/onboarding
 *
 * Creates the seller record, inactive bank detail, updates the user's role
 * and stores the verified contact phone.
 */
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import {
  type CompanyType,
  getTaxNumberError,
  isValidPhone,
  isValidTaxNumber,
  normalizePhone,
} from '@/lib/onboarding'
import { verifyTurnstileToken } from '@hanuja/api/lib/turnstile'
import { hasMatchingNormalizedTokens } from '@hanuja/security'
import { handleError } from '@hanuja/api/lib/response'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

function isValidIban(iban: string): boolean {
  return /^TR\d{24}$/.test(iban.replace(/\s/g, '').toUpperCase())
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)
}

function isCompanyType(value: string): value is CompanyType {
  return ['individual', 'sole_proprietorship', 'limited', 'joint_stock', 'other'].includes(value)
}

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request)
    if (csrfError) return csrfError
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session?.user) {
      return NextResponse.json({ message: 'Oturum acmaniz gerekiyor.' }, { status: 401 })
    }

    if (!session.user.emailVerified) {
      return NextResponse.json(
        { message: 'Basvuru yapmadan once e-posta adresinizi dogrulamaniz gerekir.' },
        { status: 403 },
      )
    }

    const existingSeller = await prisma.seller.findUnique({
      where: { userId: session.user.id },
      select: { id: true, status: true },
    })

    if (existingSeller) {
      return NextResponse.json(
        {
          message:
            existingSeller.status === 'pending'
              ? 'Basvurunuz zaten alinmis durumda.'
              : 'Bu hesap zaten bir satici hesabina bagli.',
        },
        { status: 409 },
      )
    }

    let body: {
      banka: { accountHolderName: string; bankName: string; iban: string }
      isletme: {
        address: string
        city: string
        companyName: string
        companyType: CompanyType
        district: string
        mersis?: string
        postalCode?: string
        taxNumber: string
        taxOffice: string
      }
      magaza: { city: string; description: string; slug: string; storeName: string }
      phone: string
      turnstileToken: string
    }

    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ message: 'Gecersiz istek.' }, { status: 400 })
    }

    const { banka, isletme, magaza, phone, turnstileToken } = body

    if (!magaza?.storeName || !magaza?.slug || !magaza?.description || !magaza?.city) {
      return NextResponse.json({ message: 'Magaza bilgileri eksik.' }, { status: 400 })
    }

    if (
      !isletme?.companyName ||
      !isletme?.taxNumber ||
      !isletme?.taxOffice ||
      !isletme?.address ||
      !isletme?.city ||
      !isletme?.district ||
      !isletme?.companyType
    ) {
      return NextResponse.json({ message: 'Isletme bilgileri eksik.' }, { status: 400 })
    }

    if (!banka?.accountHolderName || !banka?.iban || !banka?.bankName) {
      return NextResponse.json({ message: 'Banka bilgileri eksik.' }, { status: 400 })
    }

    if (!isCompanyType(isletme.companyType)) {
      return NextResponse.json({ message: 'Gecersiz isletme turu secildi.' }, { status: 400 })
    }

    const normalizedPhone = normalizePhone(phone)
    if (!isValidPhone(normalizedPhone)) {
      return NextResponse.json(
        { message: 'Gecerli bir Turkiye cep telefonu numarasi girin.' },
        { status: 400 },
      )
    }

    if (!isValidTaxNumber(isletme.companyType, isletme.taxNumber)) {
      return NextResponse.json(
        { message: getTaxNumberError(isletme.companyType) },
        { status: 400 },
      )
    }

    if (!isValidSlug(magaza.slug)) {
      return NextResponse.json(
        { message: "Gecersiz magaza URL'si. Yalnizca kucuk harf, rakam ve tire kullanabilirsiniz." },
        { status: 400 },
      )
    }

    if (!isValidIban(banka.iban)) {
      return NextResponse.json(
        { message: 'Gecersiz IBAN. TR ile baslayan 26 karakterlik format bekleniyor.' },
        { status: 400 },
      )
    }

    const turnstileResult = await verifyTurnstileToken({
      token: turnstileToken ?? '',
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      action: 'seller-onboarding',
    })

    if (!turnstileResult.success) {
      return NextResponse.json(
        { message: turnstileResult.message ?? 'Insan dogrulamasi tamamlanamadi.' },
        { status: 400 },
      )
    }

    if (!hasMatchingNormalizedTokens(banka.accountHolderName, isletme.companyName)) {
      return NextResponse.json(
        { message: 'IBAN hesap sahibi, sirket/isletme adi ile ayni olmalidir.' },
        { status: 422 },
      )
    }

    const slugTaken = await prisma.seller.findUnique({
      where: { slug: magaza.slug },
      select: { id: true },
    })

    if (slugTaken) {
      return NextResponse.json(
        { message: "Bu magaza URL'si kullaniliyor. Farkli bir URL secin." },
        { status: 409 },
      )
    }

    await prisma.$transaction(async (tx) => {
      const seller = await tx.seller.create({
        data: {
          userId: session.user.id,
          displayName: magaza.storeName,
          slug: magaza.slug,
          status: 'pending',
          profile: {
            create: {
              bio: magaza.description,
              city: isletme.city,
              companyName: isletme.companyName,
              district: isletme.district,
              legalAddress: isletme.address,
              mersis: isletme.mersis?.trim() || null,
              phone: normalizedPhone,
              postalCode: isletme.postalCode?.trim() || null,
              taxNumber: isletme.taxNumber,
              taxOffice: isletme.taxOffice,
            },
          },
        },
      })

      await tx.sellerBankDetail.create({
        data: {
          sellerId: seller.id,
          accountHolder: banka.accountHolderName,
          iban: banka.iban.replace(/\s/g, '').toUpperCase(),
          bankName: banka.bankName,
          isVerified: false,
          isActive: false,
        },
      })

      await tx.user.update({
        where: { id: session.user.id },
        data: {
          role: 'seller',
        },
      })
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    return handleError(error)
  }
}
