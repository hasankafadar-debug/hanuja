import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createPlatformBankAccountService } from '@hanuja/api/services/platform-bank-account.service'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const { id } = await params
  const prisma = createPrismaForRoute()

  // Siparişin bu kullanıcıya ait olduğunu ve EFT beklediğini doğrula
  const order = await prisma.order.findFirst({
    where: { id, customerId: session.user.id },
    select: { id: true, status: true },
  })

  if (!order) {
    return NextResponse.json({ error: 'Sipariş bulunamadı.' }, { status: 404 })
  }

  // bank_transfer_waiting yalnızca EFT siparişlerinde atanır
  if (order.status !== 'bank_transfer_waiting') {
    return NextResponse.json({ error: 'Bu sipariş EFT ödemesi beklemiyor.' }, { status: 400 })
  }

  const accounts = await createPlatformBankAccountService({ prisma }).listActive()
  return NextResponse.json({ data: accounts })
}
