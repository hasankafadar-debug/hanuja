/**
 * Announcement recipient selection (e-mail plan phase 5): OR within a filter, AND
 * across filters, eligibility (active/suspended) in every mode, exclusions always win.
 */
import { describe, expect, it } from 'vitest'
import {
  announcementAudienceSchema,
  buildAudienceWhere,
  buildLocationIndex,
  collectCategorySubtree,
  istanbulDayStart,
  locationKey,
  type AnnouncementAudience,
} from '../../../api/domain/announcement-audience'
import { announcementEventKey, hashAudience } from '../../../api/domain/announcement-keys'

const ELIGIBLE = { status: { in: ['active', 'suspended'] } }

function audience(overrides: Partial<AnnouncementAudience> = {}): AnnouncementAudience {
  return { mode: 'filter', filters: {}, manualSellerIds: [], excludedSellerIds: [], ...overrides }
}

const emptyContext = { locationIndex: buildLocationIndex([]), categorySubtreeIds: [] }

describe('buildAudienceWhere', () => {
  it('selects every eligible seller when no filter is set', () => {
    expect(buildAudienceWhere(audience({ mode: 'all' }), emptyContext)).toEqual({ AND: [ELIGIBLE] })
    expect(buildAudienceWhere(audience(), emptyContext)).toEqual({ AND: [ELIGIBLE] })
  })

  it('keeps eligibility in manual mode and ignores filters there', () => {
    const where = buildAudienceWhere(
      audience({
        mode: 'manual',
        manualSellerIds: ['s1', 's2'],
        filters: { statuses: ['suspended'], nameQuery: 'Noa' },
      }),
      emptyContext,
    )
    expect(where).toEqual({ AND: [ELIGIBLE, { id: { in: ['s1', 's2'] } }] })
  })

  it('narrows the status only within the eligible set', () => {
    expect(
      buildAudienceWhere(audience({ filters: { statuses: ['suspended'] } }), emptyContext),
    ).toEqual({ AND: [{ status: { in: ['suspended'] } }] })
    expect(
      buildAudienceWhere(audience({ filters: { statuses: ['active', 'suspended'] } }), emptyContext),
    ).toEqual({ AND: [{ status: { in: ['active', 'suspended'] } }] })
  })

  it('ORs location values and ANDs them with other filters', () => {
    const locationIndex = buildLocationIndex([
      { city: 'İstanbul', district: 'Kadıköy' },
      { city: 'istanbul', district: 'Merkez' },
      { city: 'Ankara', district: 'Çankaya' },
      { city: 'Amasya', district: 'Merkez' },
    ])
    const where = buildAudienceWhere(
      audience({
        filters: {
          locations: [{ city: 'ankara' }, { city: 'istanbul', district: 'merkez' }],
          nameQuery: '  Atelier ',
        },
      }),
      { locationIndex, categorySubtreeIds: [] },
    )
    expect(where.AND).toEqual([
      ELIGIBLE,
      {
        OR: [
          { profile: { is: { city: { in: ['Ankara'] } } } },
          {
            profile: {
              is: { city: { in: ['İstanbul', 'istanbul'] }, district: { in: ['Merkez'] } },
            },
          },
        ],
      },
      {
        OR: [
          { displayName: { contains: 'Atelier', mode: 'insensitive' } },
          { profile: { is: { companyName: { contains: 'Atelier', mode: 'insensitive' } } } },
        ],
      },
    ])
  })

  it('matches nobody for a location key that no profile uses', () => {
    const where = buildAudienceWhere(audience({ filters: { locations: [{ city: 'izmir' }] } }), emptyContext)
    expect(where.AND).toContainEqual({ OR: [{ profile: { is: { city: { in: [] } } } }] })
  })

  it('treats a seller without a profile as unverified; both options mean no filter', () => {
    expect(
      buildAudienceWhere(audience({ filters: { verification: ['unverified'] } }), emptyContext).AND,
    ).toContainEqual({ OR: [{ profile: { is: { isVerified: false } } }, { profile: { is: null } }] })
    expect(
      buildAudienceWhere(audience({ filters: { verification: ['verified'] } }), emptyContext).AND,
    ).toContainEqual({ profile: { is: { isVerified: true } } })
    expect(
      buildAudienceWhere(audience({ filters: { verification: ['verified', 'unverified'] } }), emptyContext),
    ).toEqual({ AND: [ELIGIBLE] })
  })

  it('uses Türkiye day boundaries for the registration range, end day inclusive', () => {
    const where = buildAudienceWhere(
      audience({ filters: { registeredFrom: '2026-09-01', registeredTo: '2026-09-02' } }),
      emptyContext,
    )
    expect(where.AND).toContainEqual({ createdAt: { gte: new Date('2026-08-31T21:00:00.000Z') } })
    expect(where.AND).toContainEqual({ createdAt: { lt: new Date('2026-09-02T21:00:00.000Z') } })
    expect(istanbulDayStart('2026-01-15').toISOString()).toBe('2026-01-14T21:00:00.000Z')
  })

  it('selects sellers with a published product in the category subtree', () => {
    const where = buildAudienceWhere(audience({ filters: { categoryIds: ['c1'] } }), {
      locationIndex: buildLocationIndex([]),
      categorySubtreeIds: ['c1', 'c2'],
    })
    expect(where.AND).toContainEqual({
      products: { some: { status: 'published', categoryId: { in: ['c1', 'c2'] } } },
    })
  })

  it('applies exclusions in every mode', () => {
    for (const mode of ['all', 'manual', 'filter'] as const) {
      const where = buildAudienceWhere(
        audience({ mode, manualSellerIds: ['s1'], excludedSellerIds: ['s9'] }),
        emptyContext,
      )
      expect(where.AND).toContainEqual({ id: { notIn: ['s9'] } })
    }
  })
})

describe('announcementAudienceSchema', () => {
  it('rejects a reversed date range and malformed dates', () => {
    expect(
      announcementAudienceSchema.safeParse(
        audience({ filters: { registeredFrom: '2026-09-10', registeredTo: '2026-09-01' } }),
      ).success,
    ).toBe(false)
    expect(
      announcementAudienceSchema.safeParse(audience({ filters: { registeredFrom: '10.09.2026' } })).success,
    ).toBe(false)
  })

  it('rejects statuses that can never receive announcements', () => {
    expect(
      announcementAudienceSchema.safeParse({ ...audience(), filters: { statuses: ['pending'] } }).success,
    ).toBe(false)
  })

  it('fills defaults for a minimal selection', () => {
    expect(announcementAudienceSchema.parse({ mode: 'all' })).toEqual({
      mode: 'all',
      filters: {},
      manualSellerIds: [],
      excludedSellerIds: [],
    })
  })
})

describe('location index', () => {
  it('groups spellings by a Turkish-insensitive key and keeps the most frequent label', () => {
    const index = buildLocationIndex([
      { city: 'İstanbul', district: null },
      { city: 'İstanbul', district: null },
      { city: 'istanbul ', district: null },
      { city: '  ', district: 'Boş' },
      { city: null, district: null },
    ])
    expect([...index.keys()]).toEqual(['istanbul'])
    expect(index.get('istanbul')).toMatchObject({ label: 'İstanbul', count: 3 })
  })

  it('keeps the same district name in two cities apart', () => {
    const index = buildLocationIndex([
      { city: 'Amasya', district: 'Merkez' },
      { city: 'Burdur', district: 'Merkez' },
    ])
    expect(index.get('amasya')?.districts.get('merkez')?.rawValues).toEqual(new Map([['Merkez', 1]]))
    expect(index.get('burdur')?.districts.get('merkez')?.count).toBe(1)
    expect(locationKey(' Kadıköy ')).toBe('kadikoy')
  })
})

describe('collectCategorySubtree', () => {
  const categories = [
    { id: 'root', parentId: null },
    { id: 'child', parentId: 'root' },
    { id: 'leaf', parentId: 'child' },
    { id: 'other', parentId: null },
  ]

  it('includes every descendant and ignores unknown ids', () => {
    expect(collectCategorySubtree(categories, ['root', 'missing']).sort()).toEqual(['child', 'leaf', 'root'])
    expect(collectCategorySubtree(categories, ['leaf'])).toEqual(['leaf'])
  })

  it('stops on a cycle instead of looping forever', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]
    expect(collectCategorySubtree(cyclic, ['a']).sort()).toEqual(['a', 'b'])
  })
})

describe('announcement keys', () => {
  it('binds a list regardless of order and duplicates', () => {
    expect(hashAudience(['b', 'a', 'a'])).toBe(hashAudience(['a', 'b']))
    expect(hashAudience(['a', 'b'])).not.toBe(hashAudience(['a', 'c']))
    expect(hashAudience([])).toMatch(/^[a-f0-9]{64}$/)
  })

  it('derives one deterministic event key per seller', () => {
    expect(announcementEventKey('ann1', 'seller1')).toBe('announcement:ann1:seller:seller1')
  })
})
