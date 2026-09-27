import { MegaMenu } from '@hanuja/ui'
import { getCustomerVisibleCategories } from '@/lib/customer-visible-categories'
import { buildStorefrontMenuItems, type FlatCategory } from '@/lib/storefront-nav-menu'

/**
 * Async server component — fetches the customer-visible category tree once
 * and passes pre-built column data to the MegaMenu client component.
 * Categories whose subtree has no published product are hidden here; they
 * reappear automatically once a product is published (launch policy).
 *
 * MegaMenu must not be wrapped in an overflow container: `overflow-x: auto`
 * also clips vertically, which hid the dropdown panel inside the 45px strip.
 * The strip scrolls horizontally inside MegaMenu itself.
 */
export async function StorefrontNav() {
  let allCats: FlatCategory[] = []
  let categoryLoadFailed = false
  try {
    allCats = await getCustomerVisibleCategories()
  } catch {
    categoryLoadFailed = true
    // Nav remains functional without sub-items if DB is unreachable at build time.
  }

  return <MegaMenu items={buildStorefrontMenuItems(allCats, categoryLoadFailed)} className="relative" />
}
