export type HomePromoSlot = 'TOP_RIGHT' | 'BOTTOM_RIGHT'

export interface HomeMediaAsset {
  id: string
  kind: string
  url: string
  variants: unknown
  durationSec: number | null
  width: number | null
  height: number | null
  originalName: string | null
  mimeType: string | null
  sizeBytes: number | null
}

export interface HomeSellerOption {
  id: string
  displayName: string
  slug: string
}

export interface HomeSlideItem {
  id: string
  sortOrder: number
  isActive: boolean
  mediaAssetId: string
  mediaAsset: HomeMediaAsset
  posterAssetId: string | null
  posterAsset: HomeMediaAsset | null
  eyebrow: string | null
  title: string
  body: string | null
  ctaLabel: string
  ctaHref: string
  startsAt: string | null
  endsAt: string | null
  sellerId: string | null
  seller: HomeSellerOption | null
  createdAt: string
  updatedAt: string
  createdBy: string
}

export interface HomePromoItem {
  id: string
  slot: HomePromoSlot
  isActive: boolean
  mediaAssetId: string
  mediaAsset: HomeMediaAsset
  title: string
  subtitle: string | null
  ctaHref: string
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string
}

export interface HomeCmsInitialData {
  slides: HomeSlideItem[]
  promos: HomePromoItem[]
  sellers: HomeSellerOption[]
}
