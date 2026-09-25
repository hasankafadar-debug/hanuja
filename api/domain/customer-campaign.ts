import { z } from 'zod'
import { istanbulDayStart } from './announcement-audience'

export const CUSTOMER_CAMPAIGN_TITLE_MAX = 150
export const CUSTOMER_CAMPAIGN_BODY_MAX = 5000
export const CUSTOMER_CAMPAIGN_MANUAL_MAX = 2000
export const CUSTOMER_CAMPAIGN_EXCLUDED_MAX = 5000

const id = z.string().trim().min(1).max(64)
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(istanbulDayStart(value).getTime()),
  'Geçersiz tarih.',
)

export const customerCampaignAudienceSchema = z.object({
  mode: z.enum(['all', 'manual', 'filter']),
  manualUserIds: z.array(id).max(CUSTOMER_CAMPAIGN_MANUAL_MAX).default([]),
  excludedUserIds: z.array(id).max(CUSTOMER_CAMPAIGN_EXCLUDED_MAX).default([]),
  filters: z.object({
    registeredFrom: dateOnly.optional(),
    registeredTo: dateOnly.optional(),
  }).default({}),
}).refine(
  (value) => !value.filters.registeredFrom || !value.filters.registeredTo ||
    value.filters.registeredFrom <= value.filters.registeredTo,
  'Kayıt tarihi aralığının başlangıcı bitişinden sonra olamaz.',
)

export type CustomerCampaignAudience = z.infer<typeof customerCampaignAudienceSchema>
export const DEFAULT_CUSTOMER_CAMPAIGN_AUDIENCE: CustomerCampaignAudience = {
  mode: 'all', manualUserIds: [], excludedUserIds: [], filters: {},
}

/** Campaign links may only lead to the public Hanuja storefront. */
export function normalizeCampaignCtaUrl(value: string | null): string | null {
  if (!value?.trim()) return null
  try {
    const parsed = new URL(value.trim(), 'https://www.hanuja.com.tr')
    if (parsed.protocol !== 'https:' || !['hanuja.com.tr', 'www.hanuja.com.tr'].includes(parsed.hostname) ||
      parsed.username || parsed.password || parsed.port) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export const customerCampaignDraftSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().max(CUSTOMER_CAMPAIGN_TITLE_MAX + 50),
  body: z.string().max(CUSTOMER_CAMPAIGN_BODY_MAX + 200),
  ctaLabel: z.string().max(80).nullable(),
  ctaUrl: z.string().max(2048).nullable(),
  mediaAssetId: id.nullable(),
  posterAssetId: id.nullable(),
  audience: customerCampaignAudienceSchema,
})

export type CustomerCampaignDraftInput = z.infer<typeof customerCampaignDraftSchema>
