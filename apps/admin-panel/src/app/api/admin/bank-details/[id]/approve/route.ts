import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createSellerBankService } from '@hanuja/api/services/seller-bank.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: string }
  if (!body.reason?.trim()) {
    return NextResponse.json({ error: 'Gerekçe zorunludur.' }, { status: 400 })
  }

  try {
    const { id } = await params
    const service = createSellerBankService({ prisma })
    await service.approvePending({ bankDetailId: id, adminActorId: session.user.id, reason: body.reason })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Onay işlemi başarısız.' },
      { status: 400 },
    )
  }
}
