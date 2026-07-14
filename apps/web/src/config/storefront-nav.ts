/**
 * Storefront top-nav configuration.
 *
 * Defines the 8 nav items shown in the header. Three items are "virtual
 * collections" — they aggregate products from multiple category sub-trees
 * (ev + ofis) and have no direct DB counterpart at the `/kategori/{slug}` URL.
 */

// Virtual collection slugs map to the DB slugs they aggregate.
// Used by both the category page (for product listing) and the nav builder
// (for mega-menu column construction).
export const VIRTUAL_COLLECTION_MAP = {
  mobilya: ['ev-mobilya', 'ofis-mobilya'],
  aydinlatma: ['ev-aydinlatma', 'ofis-aydinlatma'],
  aksesuar: ['ev-aksesuar', 'ofis-aksesuar'],
} as const

export type VirtualCollectionSlug = keyof typeof VIRTUAL_COLLECTION_MAP

export const VIRTUAL_COLLECTION_SLUGS = Object.keys(
  VIRTUAL_COLLECTION_MAP,
) as VirtualCollectionSlug[]

export function isVirtualCollection(slug: string): slug is VirtualCollectionSlug {
  return (VIRTUAL_COLLECTION_SLUGS as string[]).includes(slug)
}

// Virtual collection display labels used in mega-menu column headers.
export const VIRTUAL_COLLECTION_LABELS: Record<
  VirtualCollectionSlug,
  { ev: string; ofis: string }
> = {
  mobilya: { ev: 'EV MOBİLYASI', ofis: 'OFİS MOBİLYASI' },
  aydinlatma: { ev: 'EV AYDINLATMASI', ofis: 'OFİS AYDINLATMASI' },
  aksesuar: { ev: 'EV AKSESUARLARI', ofis: 'OFİS AKSESUARLARI' },
}

// Each nav item: either a direct link into the category tree or a virtual
// collection that aggregates two sub-trees.
//
// UYARI: rootSlug / VIRTUAL_COLLECTION_MAP değerleri DB kategori slug'larına
// string literal olarak bağlıdır. Admin panelden bir kök slug değiştirilirse
// ilgili nav öğesi (ve anasayfa kartı / footer linki) sessizce kaybolur —
// boş-kategori gizleme özelliği çalışıyormuş gibi görünür. Slug değiştirmeden
// önce buradaki eşlemeleri güncelleyin.
export type StorefrontNavItemConfig =
  | {
      kind: 'tree'
      label: string
      href: string
      // DB slug for the root/mid-level category whose children fill the menu.
      rootSlug: string
    }
  | {
      kind: 'collection'
      label: string
      href: string
      collectionSlug: VirtualCollectionSlug
    }
  | {
      kind: 'link'
      label: string
      href: string
    }

export const STOREFRONT_NAV_ITEMS: StorefrontNavItemConfig[] = [
  { kind: 'tree', label: 'Ev', href: '/kategori/ev', rootSlug: 'ev' },
  { kind: 'tree', label: 'Ofis', href: '/kategori/ofis', rootSlug: 'ofis' },
  {
    kind: 'collection',
    label: 'Mobilya',
    href: '/kategori/mobilya',
    collectionSlug: 'mobilya',
  },
  {
    kind: 'tree',
    label: 'Mutfak & Sofra',
    href: '/kategori/ev-mutfak',
    rootSlug: 'ev-mutfak',
  },
  {
    kind: 'collection',
    label: 'Aydınlatma',
    href: '/kategori/aydinlatma',
    collectionSlug: 'aydinlatma',
  },
  {
    kind: 'tree',
    label: 'Dekorasyon',
    href: '/kategori/ev-dekorasyon',
    rootSlug: 'ev-dekorasyon',
  },
  {
    kind: 'collection',
    label: 'Aksesuar',
    href: '/kategori/aksesuar',
    collectionSlug: 'aksesuar',
  },
  {
    kind: 'tree',
    label: 'Tekstil',
    href: '/kategori/ev-tekstil',
    rootSlug: 'ev-tekstil',
  },
  {
    kind: 'link',
    label: 'İndirim',
    href: '/urunler?vitrin=discounts&indirimli=1',
  },
]
