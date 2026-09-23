/**
 * Announcement recipient selection (e-mail plan phase 5) — pure rules, no I/O.
 *
 * Only sellers who can open the seller panel are ever eligible: `active` and
 * `suspended`. Within one filter the selected values are OR'ed; different
 * filters are AND'ed. Exclusions always win. The service resolves the saved
 * selection to a sorted id list and binds it to the send with `hashAudience`
 * (announcement-keys.ts). No Node-only imports: admin client components use the schema.
 */
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { tokenizeNormalizedText } from '@hanuja/security/turkish-normalize'

export const ANNOUNCEMENT_ELIGIBLE_STATUSES = ['active', 'suspended'] as const
export type AnnouncementSellerStatus = (typeof ANNOUNCEMENT_ELIGIBLE_STATUSES)[number]

export const ANNOUNCEMENT_TITLE_MAX = 150
export const ANNOUNCEMENT_TITLE_MIN = 3
export const ANNOUNCEMENT_BODY_MAX = 5000
export const ANNOUNCEMENT_MANUAL_MAX = 2000
export const ANNOUNCEMENT_EXCLUDED_MAX = 5000

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const idSchema = z.string().trim().min(1).max(64)

const dateOnlySchema = z
  .string()
  .regex(DATE_ONLY, 'Tarih YYYY-AA-GG biçiminde olmalı.')
  .refine((value) => !Number.isNaN(istanbulDayStart(value).getTime()), 'Geçersiz tarih.')

export const announcementAudienceSchema = z
  .object({
    mode: z.enum(['all', 'manual', 'filter']),
    filters: z
      .object({
        statuses: z.array(z.enum(ANNOUNCEMENT_ELIGIBLE_STATUSES)).max(2).optional(),
        /** Normalized location keys (see `locationKey`), not the raw stored text. */
        locations: z
          .array(
            z.object({
              city: z.string().trim().min(1).max(80),
              district: z.string().trim().min(1).max(80).optional(),
            }),
          )
          .max(200)
          .optional(),
        verification: z.array(z.enum(['verified', 'unverified'])).max(2).optional(),
        registeredFrom: dateOnlySchema.optional(),
        registeredTo: dateOnlySchema.optional(),
        categoryIds: z.array(idSchema).max(200).optional(),
        nameQuery: z.string().trim().max(100).optional(),
      })
      .default({}),
    manualSellerIds: z.array(idSchema).max(ANNOUNCEMENT_MANUAL_MAX).default([]),
    excludedSellerIds: z.array(idSchema).max(ANNOUNCEMENT_EXCLUDED_MAX).default([]),
  })
  .refine(
    (audience) =>
      !audience.filters.registeredFrom ||
      !audience.filters.registeredTo ||
      audience.filters.registeredFrom <= audience.filters.registeredTo,
    { message: 'Kayıt tarihi aralığının başlangıcı bitişinden sonra olamaz.' },
  )

export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>

export const DEFAULT_ANNOUNCEMENT_AUDIENCE: AnnouncementAudience = {
  mode: 'filter',
  filters: {},
  manualSellerIds: [],
  excludedSellerIds: [],
}

/** Parses a stored audience; a malformed row is a validation error, not a crash. */
export function parseAnnouncementAudience(value: unknown): AnnouncementAudience {
  const parsed = announcementAudienceSchema.safeParse(value)
  if (!parsed.success) throw new Error('ANNOUNCEMENT_AUDIENCE_INVALID')
  return parsed.data
}

/** Turkish-insensitive key for free-text city/district values ("Kadıköy " → "kadikoy"). */
export function locationKey(value: string): string {
  return tokenizeNormalizedText(value).join(' ')
}

export interface LocationDistrictEntry {
  key: string
  /** The most frequent stored spelling. */
  label: string
  /** Stored spelling → number of profiles using it. */
  rawValues: Map<string, number>
  count: number
}

export interface LocationCityEntry extends LocationDistrictEntry {
  districts: Map<string, LocationDistrictEntry>
}

export type LocationIndex = Map<string, LocationCityEntry>

function addRawValue(entry: LocationDistrictEntry, raw: string) {
  entry.rawValues.set(raw, (entry.rawValues.get(raw) ?? 0) + 1)
  entry.count += 1
}

function pickLabel(entry: LocationDistrictEntry) {
  let best = entry.label
  let bestCount = -1
  for (const [raw, count] of entry.rawValues) {
    if (count > bestCount) {
      best = raw.trim()
      bestCount = count
    }
  }
  entry.label = best
}

/**
 * Groups the stored (city, district) pairs by normalized key. District keys are
 * nested under their city, so the same district name in two cities ("Merkez")
 * stays two different options.
 */
export function buildLocationIndex(
  pairs: ReadonlyArray<{ city: string | null; district: string | null }>,
): LocationIndex {
  const index: LocationIndex = new Map()
  for (const pair of pairs) {
    if (!pair.city?.trim()) continue
    const cityKey = locationKey(pair.city)
    if (!cityKey) continue
    let cityEntry = index.get(cityKey)
    if (!cityEntry) {
      cityEntry = { key: cityKey, label: pair.city.trim(), rawValues: new Map(), count: 0, districts: new Map() }
      index.set(cityKey, cityEntry)
    }
    addRawValue(cityEntry, pair.city)
    if (!pair.district?.trim()) continue
    const districtKey = locationKey(pair.district)
    if (!districtKey) continue
    let districtEntry = cityEntry.districts.get(districtKey)
    if (!districtEntry) {
      districtEntry = { key: districtKey, label: pair.district.trim(), rawValues: new Map(), count: 0 }
      cityEntry.districts.set(districtKey, districtEntry)
    }
    addRawValue(districtEntry, pair.district)
  }
  for (const cityEntry of index.values()) {
    pickLabel(cityEntry)
    for (const districtEntry of cityEntry.districts.values()) pickLabel(districtEntry)
  }
  return index
}

/** Start of a calendar day in Türkiye (fixed UTC+03:00, no DST since 2016). */
export function istanbulDayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000+03:00`)
}

function istanbulNextDayStart(date: string): Date {
  return new Date(istanbulDayStart(date).getTime() + 24 * 60 * 60 * 1000)
}

/** The selected categories plus every descendant, inactive branches included. */
export function collectCategorySubtree(
  categories: ReadonlyArray<{ id: string; parentId: string | null }>,
  selectedIds: readonly string[],
): string[] {
  const children = new Map<string, string[]>()
  for (const category of categories) {
    if (!category.parentId) continue
    const list = children.get(category.parentId) ?? []
    list.push(category.id)
    children.set(category.parentId, list)
  }
  const known = new Set(categories.map((category) => category.id))
  const result = new Set<string>()
  const stack = selectedIds.filter((id) => known.has(id))
  while (stack.length) {
    const id = stack.pop()!
    if (result.has(id)) continue
    result.add(id)
    stack.push(...(children.get(id) ?? []))
  }
  return [...result]
}

export interface AudienceResolutionContext {
  locationIndex: LocationIndex
  /** Subtree of the selected categories; required when the category filter is set. */
  categorySubtreeIds: readonly string[]
}

function locationCondition(
  selected: NonNullable<AnnouncementAudience['filters']['locations']>,
  index: LocationIndex,
): Prisma.SellerWhereInput {
  return {
    OR: selected.map((location) => {
      const cityEntry = index.get(location.city)
      const cities = [...(cityEntry?.rawValues.keys() ?? [])]
      if (!location.district) return { profile: { is: { city: { in: cities } } } }
      const districts = [...(cityEntry?.districts.get(location.district)?.rawValues.keys() ?? [])]
      return { profile: { is: { city: { in: cities }, district: { in: districts } } } }
    }),
  }
}

function verificationCondition(
  selected: NonNullable<AnnouncementAudience['filters']['verification']>,
): Prisma.SellerWhereInput | null {
  const verified = selected.includes('verified')
  const unverified = selected.includes('unverified')
  if (verified === unverified) return null
  if (verified) return { profile: { is: { isVerified: true } } }
  // A seller without a profile row has never been verified either.
  return { OR: [{ profile: { is: { isVerified: false } } }, { profile: { is: null } }] }
}

/**
 * Prisma filter for the sellers an audience selects. Eligibility is applied in every
 * mode; a filter left empty does not narrow the result.
 */
export function buildAudienceWhere(
  audience: AnnouncementAudience,
  context: AudienceResolutionContext,
): Prisma.SellerWhereInput {
  const { filters } = audience
  const statuses =
    audience.mode === 'filter' && filters.statuses?.length
      ? filters.statuses
      : [...ANNOUNCEMENT_ELIGIBLE_STATUSES]
  const and: Prisma.SellerWhereInput[] = [{ status: { in: statuses } }]

  if (audience.mode === 'manual') {
    and.push({ id: { in: audience.manualSellerIds } })
  }

  if (audience.mode === 'filter') {
    if (filters.locations?.length) and.push(locationCondition(filters.locations, context.locationIndex))
    if (filters.verification?.length) {
      const condition = verificationCondition(filters.verification)
      if (condition) and.push(condition)
    }
    if (filters.registeredFrom) and.push({ createdAt: { gte: istanbulDayStart(filters.registeredFrom) } })
    if (filters.registeredTo) and.push({ createdAt: { lt: istanbulNextDayStart(filters.registeredTo) } })
    if (filters.categoryIds?.length) {
      and.push({
        products: {
          some: { status: 'published', categoryId: { in: [...context.categorySubtreeIds] } },
        },
      })
    }
    const nameQuery = filters.nameQuery?.trim()
    if (nameQuery) {
      and.push({
        OR: [
          { displayName: { contains: nameQuery, mode: 'insensitive' } },
          { profile: { is: { companyName: { contains: nameQuery, mode: 'insensitive' } } } },
        ],
      })
    }
  }

  if (audience.excludedSellerIds.length) {
    and.push({ id: { notIn: audience.excludedSellerIds } })
  }
  return { AND: and }
}
