import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

export const PLATFORM_SETTINGS_ID = 'platform'

export const DEFAULT_PLATFORM_SETTINGS = {
  standardPenaltyRate: new Decimal('0.2000'),
  fulfillmentDays: 20,
  fulfillmentWarningDays: 5,
  payoutHoldDays: 30,
  freeShippingThresholdTry: new Decimal(1500),
  flatShippingFeeTry: new Decimal(99),
  defaultTaxRate: new Decimal('0.2000'),
}

export type PlatformSettingsSnapshot = typeof DEFAULT_PLATFORM_SETTINGS

export function createPlatformSettingsService({ prisma }: { prisma: PrismaClient }) {
  async function get() {
    const row = await prisma.platformSettings.upsert({
      where: { id: PLATFORM_SETTINGS_ID },
      update: {},
      create: { id: PLATFORM_SETTINGS_ID },
    })

    return {
      standardPenaltyRate: row.standardPenaltyRate,
      fulfillmentDays: row.fulfillmentDays,
      fulfillmentWarningDays: row.fulfillmentWarningDays,
      payoutHoldDays: row.payoutHoldDays,
      freeShippingThresholdTry: row.freeShippingThresholdTry,
      flatShippingFeeTry: row.flatShippingFeeTry,
      defaultTaxRate: row.defaultTaxRate,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    }
  }

  async function update(params: {
    standardPenaltyRate: Decimal
    fulfillmentDays: number
    fulfillmentWarningDays: number
    payoutHoldDays: number
    freeShippingThresholdTry: Decimal
    flatShippingFeeTry: Decimal
    defaultTaxRate: Decimal
    updatedBy: string
  }) {
    return prisma.platformSettings.upsert({
      where: { id: PLATFORM_SETTINGS_ID },
      create: { id: PLATFORM_SETTINGS_ID, ...params },
      update: params,
    })
  }

  return { get, update }
}

export type PlatformSettingsService = ReturnType<typeof createPlatformSettingsService>
