import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'
import { createCatalogService } from '@hanuja/api/services/catalog.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const createProductSchema = z.object({
  name: z.string().min(3, 'Ürün adı en az 3 karakter olmalı').max(200),
  categoryId: z.string().min(1, 'Kategori seçimi zorunludur'),
  price: z.number().positive('Fiyat 0\'dan büyük olmalı'),
  stockQuantity: z.number().int().min(0, 'Stok negatif olamaz'),
  description: z.string().max(5000).optional().default(''),
})

/** POST /api/seller/products — yeni ürün ekle */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  if (seller.status !== 'active') {
    return NextResponse.json({ error: 'Ürün eklemek için satıcı hesabınızın aktif olması gerekir.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = createProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Geçersiz veri.' }, { status: 400 })
  }

  const svc = createCatalogService({ prisma })
  const product = await svc.createProduct({
    sellerId: seller.id,
    categoryId: parsed.data.categoryId,
    name: parsed.data.name,
    description: parsed.data.description ?? '',
    price: new Decimal(parsed.data.price),
    stockQuantity: parsed.data.stockQuantity,
  })

  return NextResponse.json({ productId: product.id }, { status: 201 })
}
