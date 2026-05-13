import { NextRequest, NextResponse } from 'next/server'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const type = searchParams.get('type')

  if (type !== 'color' && type !== 'material') {
    return NextResponse.json({ error: 'type must be color or material' }, { status: 400 })
  }

  const prisma = createPrismaForRoute()
  const options = await prisma.productAttributeOption.findMany({
    where: { type, isActive: true },
    select: { id: true, slug: true, label: true, hexColor: true },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })

  return NextResponse.json({ options })
}
