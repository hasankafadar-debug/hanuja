import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { DomainError } from '@hanuja/api/lib/errors'
import { createSellerService } from '@hanuja/api/services/seller.service'

const vacationModeSchema = z.object({
  enabled: z.boolean(),
})

/** PATCH /api/seller/vacation-mode — satıcının Tatil Modu durumunu günceller. */
export async function PATCH(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = vacationModeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Geçerli bir Tatil Modu durumu gönderin.' }, { status: 400 })
  }

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  try {
    const vacationModeEnabled = await createSellerService({ prisma }).updateVacationMode(
      seller.id,
      session.user.id,
      parsed.data.enabled,
    )

    return NextResponse.json({ success: true, vacationModeEnabled })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[seller] Tatil Modu güncellenemedi:', error)
    return NextResponse.json({ error: 'Tatil Modu güncellenemedi.' }, { status: 500 })
  }
}
