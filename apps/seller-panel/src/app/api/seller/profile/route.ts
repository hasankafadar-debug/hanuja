import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'
import { createSellerService } from '@hanuja/api/services/seller.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Geçerli bir renk kodu girin (örn. #FF0000)')

const profileSchema = z.object({
  storeName: z.string().min(2, 'Mağaza adı en az 2 karakter olmalı').max(80).optional(),
  bio: z.string().max(1000).optional(),
  phone: z.string().max(20).optional(),
  companyName: z.string().max(160).optional(),
  legalAddress: z.string().max(500).optional(),
  district: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  postalCode: z.string().max(20).optional(),
  taxOffice: z.string().max(120).optional(),
  taxNumber: z.string().max(20).optional(),
  mersis: z.string().max(30).optional(),
  logoUrl: z.string().url('Geçerli bir URL girin').max(500).startsWith('https://', 'Yalnızca HTTPS URL kabul edilir').optional(),
  bannerUrl: z.string().url('Geçerli bir URL girin').max(500).startsWith('https://', 'Yalnızca HTTPS URL kabul edilir').optional(),
  bannerColor: hexColor.optional(),
  bannerHeadline: z.string().max(60, 'Banner başlığı en fazla 60 karakter olabilir').optional(),
  bannerTextColor: hexColor.optional(),
  bannerHeadlineFontSize: z.enum(['sm', 'md', 'lg', 'xl']).optional(),
})

/** PATCH /api/seller/profile — mağaza profili güncelle */
export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = profileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Geçersiz veri.' }, { status: 400 })
  }

  const {
    storeName,
    bio,
    phone,
    companyName,
    legalAddress,
    district,
    city,
    postalCode,
    taxOffice,
    taxNumber,
    mersis,
    logoUrl,
    bannerUrl,
    bannerColor,
    bannerHeadline,
    bannerTextColor,
    bannerHeadlineFontSize,
  } = parsed.data
  const svc = createSellerService({ prisma })
  await svc.updateProfile(seller.id, session.user.id, {
    ...(storeName !== undefined ? { storeName } : {}),
    ...(bio !== undefined ? { bio } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(companyName !== undefined ? { companyName } : {}),
    ...(legalAddress !== undefined ? { legalAddress } : {}),
    ...(district !== undefined ? { district } : {}),
    ...(city !== undefined ? { city } : {}),
    ...(postalCode !== undefined ? { postalCode } : {}),
    ...(taxOffice !== undefined ? { taxOffice } : {}),
    ...(taxNumber !== undefined ? { taxNumber } : {}),
    ...(mersis !== undefined ? { mersis } : {}),
    ...(logoUrl !== undefined ? { logoUrl } : {}),
    ...(bannerUrl !== undefined ? { bannerUrl } : {}),
    ...(bannerColor !== undefined ? { bannerColor } : {}),
    ...(bannerHeadline !== undefined ? { bannerHeadline } : {}),
    ...(bannerTextColor !== undefined ? { bannerTextColor } : {}),
    ...(bannerHeadlineFontSize !== undefined ? { bannerHeadlineFontSize } : {}),
  })

  return NextResponse.json({ success: true })
}
