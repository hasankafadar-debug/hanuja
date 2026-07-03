import { NextRequest, NextResponse } from 'next/server'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { sortAttributeOptions } from '@/lib/attribute-option-sort'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const prisma = createPrismaForRoute()

  const category = await prisma.category.findUnique({
    where: { slug },
    select: {
      id: true,
      attributeOptions: {
        select: {
          option: {
            select: { id: true, type: true, slug: true, label: true, hexColor: true },
          },
        },
      },
    },
  })

  if (!category) {
    return NextResponse.json({ error: 'Kategori bulunamadi.' }, { status: 404 })
  }

  const options = category.attributeOptions.map((ao) => ao.option)
  const colorOptions = sortAttributeOptions(options.filter((o) => o.type === 'color'))
  const materialOptions = sortAttributeOptions(options.filter((o) => o.type === 'material'))

  // Fall back to all active options if none are category-specific
  if (colorOptions.length === 0 && materialOptions.length === 0) {
    const allOptions = await prisma.productAttributeOption.findMany({
      where: { isActive: true },
      select: { id: true, type: true, slug: true, label: true, hexColor: true },
      orderBy: { label: 'asc' },
    })
    return NextResponse.json({
      colorOptions: sortAttributeOptions(allOptions.filter((o) => o.type === 'color')),
      materialOptions: sortAttributeOptions(allOptions.filter((o) => o.type === 'material')),
    })
  }

  return NextResponse.json({ colorOptions, materialOptions })
}
