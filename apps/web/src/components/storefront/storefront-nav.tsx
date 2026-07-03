import { MegaMenu, type MegaMenuItem, type MegaMenuColumn } from '@hanuja/ui'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import {
  STOREFRONT_NAV_ITEMS,
  VIRTUAL_COLLECTION_MAP,
  VIRTUAL_COLLECTION_LABELS,
  type StorefrontNavItemConfig,
} from '@/config/storefront-nav'

type FlatCategory = {
  id: string
  parentId: string | null
  slug: string
  name: string
}

/** Build a full hierarchical path from a category slug upward through the tree. */
function buildCategoryHref(slug: string, allCats: FlatCategory[]): string {
  const cat = allCats.find((c) => c.slug === slug)
  if (!cat) return `/kategori/${slug}`

  const path: string[] = []
  let current: FlatCategory | undefined = cat
  while (current) {
    path.unshift(current.slug)
    const parentId: string | null = current.parentId
    current = parentId ? allCats.find((c) => c.id === parentId) : undefined
  }
  return `/kategori/${path.join('/')}`
}

/** Direct children of a category, by slug. */
function childrenOf(parentSlug: string, allCats: FlatCategory[]): FlatCategory[] {
  const parent = allCats.find((c) => c.slug === parentSlug)
  if (!parent) return []
  return allCats.filter((c) => c.parentId === parent.id)
}

/** Build MegaMenuItem for a single nav config item. */
function buildMenuItem(
  item: StorefrontNavItemConfig,
  allCats: FlatCategory[],
): MegaMenuItem {
  if (item.kind === 'link') {
    return { label: item.label, href: item.href, columns: [] }
  }

  if (item.kind === 'collection') {
    const aggregateSlugs = VIRTUAL_COLLECTION_MAP[item.collectionSlug]
    const labels = VIRTUAL_COLLECTION_LABELS[item.collectionSlug]

    const columns: MegaMenuColumn[] = []

    // ev sub-tree column
    const evSlug = aggregateSlugs[0]
    const evChildren = childrenOf(evSlug, allCats)
    if (evChildren.length > 0) {
      columns.push({
        header: labels.ev,
        href: buildCategoryHref(evSlug, allCats),
        items: evChildren.map((c) => ({
          label: c.name,
          href: buildCategoryHref(c.slug, allCats),
        })),
      })
    }

    // ofis sub-tree column
    const ofisSlug = aggregateSlugs[1]
    const ofisChildren = childrenOf(ofisSlug, allCats)
    if (ofisChildren.length > 0) {
      columns.push({
        header: labels.ofis,
        href: buildCategoryHref(ofisSlug, allCats),
        items: ofisChildren.map((c) => ({
          label: c.name,
          href: buildCategoryHref(c.slug, allCats),
        })),
      })
    }

    return { label: item.label, href: item.href, columns }
  }

  // tree item
  const children = childrenOf(item.rootSlug, allCats)
  if (children.length === 0) {
    return { label: item.label, href: item.href, columns: [] }
  }

  const column: MegaMenuColumn = {
    header: item.label.toUpperCase(),
    items: children.map((c) => ({
      label: c.name,
      href: buildCategoryHref(c.slug, allCats),
    })),
  }
  return { label: item.label, href: item.href, columns: [column] }
}

/**
 * Async server component — fetches category tree once and passes
 * pre-built column data to the MegaMenu client component.
 */
export async function StorefrontNav() {
  let allCats: FlatCategory[] = []
  try {
    const svc = createCatalogService({ prisma: createPrismaForRoute() })
    allCats = await svc.listAllCategories()
  } catch {
    // Nav remains functional without sub-items if DB is unreachable at build time.
  }

  const menuItems: MegaMenuItem[] = STOREFRONT_NAV_ITEMS.map((item) =>
    buildMenuItem(item, allCats),
  )

  return <MegaMenu items={menuItems} className="relative" />
}
