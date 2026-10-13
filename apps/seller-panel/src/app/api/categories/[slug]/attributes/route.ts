import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { sortAttributeOptions } from '@/lib/attribute-option-sort'
import { resolveCategorySchema } from '@hanuja/api/services/category-schema.service'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  if (!['seller', 'admin'].includes(session.user.role))
    return NextResponse.json({ error: 'Yetkiniz yok.' }, { status: 403 })
  const { slug } = await params
  const prisma = createPrismaForRoute()

  const category = await prisma.category.findFirst({
    where: { OR: [{ slug }, { id: slug }] },
    select: {
      id: true,
      attributeOptions: {
        select: {
          option: {
            select: {
              id: true,
              type: true,
              slug: true,
              label: true,
              hexColor: true,
              sortOrder: true,
            },
          },
        },
      },
    },
  })

  if (!category) {
    return NextResponse.json({ error: 'Kategori bulunamadi.' }, { status: 404 })
  }
  const schema = await resolveCategorySchema(prisma, category.id)
  const productId = _req.nextUrl.searchParams.get('productId')
  const retained = productId
    ? await prisma.product.findFirst({
        where: { id: productId, categoryId: category.id, seller: { userId: session.user.id } },
        select: { attributeValues: { include: { option: true } } },
      })
    : null
  const retainedOptions = retained?.attributeValues.map((v) => v.option) ?? []

  const options = category.attributeOptions.map((ao) => ao.option)
  const colorOptions = sortAttributeOptions(options.filter((o) => o.type === 'color'))
  const materialOptions = sortAttributeOptions(options.filter((o) => o.type === 'material'))

  // Fall back to all active options if none are category-specific
  if (colorOptions.length === 0 && materialOptions.length === 0) {
    const allOptions = await prisma.productAttributeOption.findMany({
      where: { isActive: true },
      select: { id: true, type: true, slug: true, label: true, hexColor: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    })
    return NextResponse.json({
      ...schema,
      colorOptions: sortAttributeOptions([
        ...new Map(
          [...allOptions, ...retainedOptions]
            .filter((o) => o.type === 'color')
            .map((o) => [o.id, o]),
        ).values(),
      ]),
      materialOptions: sortAttributeOptions(
        [...new Map([...allOptions, ...retainedOptions].map((o) => [o.id, o])).values()].filter(
          (o) =>
            o.type === 'material' &&
            (!schema.config.materialLabels.length ||
              schema.config.materialLabels.includes(o.label) ||
              retainedOptions.some((v) => v.id === o.id)),
        ),
      ),
    })
  }

  return NextResponse.json({
    ...schema,
    colorOptions,
    materialOptions: materialOptions.filter(
      (o) => !schema.config.materialLabels.length || schema.config.materialLabels.includes(o.label),
    ),
  })
}
