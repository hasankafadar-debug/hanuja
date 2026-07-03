import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createPlatformSettingsService } from '@hanuja/api/services/platform-settings.service'

const schema = z.object({
  standardPenaltyRate: z.number().min(0).max(1),
  dailyPenaltyRate: z.number().min(0).max(1),
  defaultSellerCommissionRate: z.number().min(0).max(1),
  fulfillmentDays: z.number().int().min(1).max(90),
  fulfillmentWarningDays: z.number().int().min(1).max(30),
  payoutHoldDays: z.number().int().min(1).max(120),
  freeShippingThresholdTry: z.number().min(0).max(1000000),
  flatShippingFeeTry: z.number().min(0).max(100000),
  eftDiscountRate: z.number().min(0).max(1),
})

export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Bu işlem için admin yetkisi gerekir.' }, { status: 403 })
  }

  const body = schema.parse(await req.json())
  const svc = createPlatformSettingsService({ prisma: createPrismaForRoute() })
  const current = await svc.get()
  const result = await svc.update({
    standardPenaltyRate: new Decimal(body.standardPenaltyRate),
    dailyPenaltyRate: new Decimal(body.dailyPenaltyRate),
    defaultSellerCommissionRate: new Decimal(body.defaultSellerCommissionRate),
    fulfillmentDays: body.fulfillmentDays,
    fulfillmentWarningDays: body.fulfillmentWarningDays,
    payoutHoldDays: body.payoutHoldDays,
    freeShippingThresholdTry: new Decimal(body.freeShippingThresholdTry),
    flatShippingFeeTry: new Decimal(body.flatShippingFeeTry),
    defaultTaxRate: current.defaultTaxRate,
    eftDiscountRate: new Decimal(body.eftDiscountRate),
    updatedBy: session.user.id,
  })

  return NextResponse.json({ success: true, data: result })
}
