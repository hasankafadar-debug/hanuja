import {
  ImportAdapter,
  type ScrapedProduct,
  type ScrapedProductCollection,
  type ScrapedProductVariant,
} from './import-adapter'

const USER_AGENT = 'Hanuja-Import-Bot/1.0 (+https://hanuja.com/bot)'
const HIPICON_API_ORIGIN = 'https://api.hipicon.com'

interface HipiconProduct {
  id: string
  name: string
  displayPrice: number
  priceWithoutDiscount?: number | null
  originalPrice?: number | null
  stockCode?: string | null
  imageURL?: string | null
  hoverImageURL?: string | null
  additionalImageURLs?: string[] | null
  productPath: string
  category?: { name?: string | null } | string | null
  categoryTree?: string | null
  stockQuantity?: number | null
  availableStock?: number | null
  quantity?: number | null
}

interface HipiconProductDetail {
  description?: string | null
  productDescription?: string | null
  productDescriptionText?: string | null
  summary?: string | null
  shortDescription?: string | null
  subtitle?: string | null
  excerpt?: string | null
  story?: string | null
  productStory?: string | null
  productStoryText?: string | null
  careInstructions?: string | null
  composition?: string | null
  category?: { name?: string | null } | string | null
  categoryTree?: string | null
  breadCrumb?: {
    title?: string | null
    rawLabel?: string | null
  } | null
  barcode?: string | null
  stockCode?: string | null
  imageURLs?: string[] | null
  stockQuantity?: number | null
  availableStock?: number | null
  quantity?: number | null
  variants?: Array<{
    name?: string | null
    barcode?: string | null
    price?: number | null
    originalPrice?: number | null
    stockQuantity?: number | null
    availableStock?: number | null
    quantity?: number | null
  }> | null
}

interface HipiconCatalogResponse {
  data?: {
    productList?: HipiconProduct[]
    productListDetail?: {
      totalProductCount?: number
      totalPageCount?: number
    }
  }
}

interface HipiconProductDetailResponse {
  data?: HipiconProductDetail
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getDesignerSlug(url: URL) {
  const [slug] = url.pathname.split('/').filter(Boolean)
  if (!slug) {
    throw new Error('Geçerli bir Hipicon mağaza URLsi girin.')
  }
  return slug
}

function extractCategoryName(category: HipiconProduct['category']): string | undefined {
  if (!category) return undefined
  if (typeof category === 'string') return category.trim() || undefined
  if (typeof category === 'object' && category.name) return category.name.trim() || undefined
  return undefined
}

function stripHtml(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&uuml;/gi, 'ü')
    .replace(/&Uuml;/g, 'Ü')
    .replace(/&ouml;/gi, 'ö')
    .replace(/&Ouml;/g, 'Ö')
    .replace(/&ccedil;/gi, 'ç')
    .replace(/&Ccedil;/g, 'Ç')
    .replace(/&rsquo;/gi, '’')
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return normalized || undefined
}

function firstText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = stripHtml(value)
    if (normalized) return normalized
  }
  return undefined
}

function normalizeStockCode(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeBarcodeCandidate(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized && /^\d{1,13}$/.test(normalized) ? normalized : undefined
}

function extractDetailCategoryPath(detail: HipiconProductDetail | null): string[] | undefined {
  if (!detail) return undefined
  if (detail.breadCrumb?.rawLabel) {
    const parts = detail.breadCrumb.rawLabel.split('>').map((item) => item.trim()).filter(Boolean)
    if (parts.length > 0) return parts
  }
  if (detail.categoryTree) {
    const parts = detail.categoryTree.split('>').map((item) => item.trim()).filter(Boolean)
    if (parts.length > 0) return parts
  }
  return undefined
}

function extractDetailCategory(detail: HipiconProductDetail | null) {
  if (!detail) return undefined
  const path = extractDetailCategoryPath(detail)
  if (path && path.length > 0) return path.join(' / ')
  return detail.breadCrumb?.title?.trim() || extractCategoryName(detail.category)
}

function safeStock(
  ...values: Array<number | null | undefined>
): number | undefined {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      const n = Number(value)
      if (!isNaN(n)) return Math.max(0, Math.trunc(n))
    }
  }
  return undefined
}

function normalizeProduct(
  product: HipiconProduct,
  storefrontOrigin: string,
  detail: HipiconProductDetail | null,
): ScrapedProduct {
  const imageUrls = Array.from(
    new Set(
      [
        product.imageURL,
        product.hoverImageURL,
        ...(product.additionalImageURLs ?? []),
        ...(detail?.imageURLs ?? []),
      ].filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, 8)

  const compareAtPrice = product.originalPrice ?? product.priceWithoutDiscount ?? undefined

  const categoryPath =
    extractDetailCategoryPath(detail) ??
    (product.categoryTree
      ? product.categoryTree.split('>').map((item) => item.trim()).filter(Boolean)
      : undefined)
  const suggestedCategoryName =
    categoryPath && categoryPath.length > 0
      ? categoryPath.join(' / ')
      : extractCategoryName(product.category)
  const description = firstText(
    detail?.description,
    detail?.productDescription,
    detail?.productDescriptionText,
  )
  const shortDescription = firstText(
    detail?.summary,
    detail?.shortDescription,
    detail?.subtitle,
    detail?.excerpt,
  ) ?? (description ? description.split(/[.!?]/)[0]?.trim().slice(0, 220) : undefined)
  const story = firstText(detail?.story, detail?.productStory, detail?.productStoryText)
  const careInstructions = firstText(detail?.careInstructions, detail?.composition)
  const sku = normalizeStockCode(detail?.stockCode ?? product.stockCode)
  const barcode = normalizeBarcodeCandidate(detail?.barcode) ?? normalizeBarcodeCandidate(sku)
  const stockQuantity = safeStock(
    detail?.stockQuantity,
    detail?.availableStock,
    detail?.quantity,
    product.stockQuantity,
    product.availableStock,
    product.quantity,
  )

  const variants: ScrapedProductVariant[] | undefined =
    detail?.variants && detail.variants.length > 0
      ? detail.variants
          .filter((v) => v.name)
          .map((v) => {
            const variantStock = safeStock(v.stockQuantity, v.availableStock, v.quantity)
            return {
              name: v.name as string,
              ...(v.barcode ? { barcode: v.barcode } : {}),
              ...(v.price !== undefined && v.price !== null ? { price: Number(v.price) } : {}),
              ...(v.originalPrice !== undefined && v.originalPrice !== null
                ? { compareAtPrice: Number(v.originalPrice) }
                : {}),
              ...(variantStock !== undefined ? { stockQuantity: variantStock } : {}),
            }
          })
      : undefined

  return {
    externalId: product.id,
    name: product.name,
    price: Number(product.displayPrice),
    imageUrls,
    externalUrl: new URL(product.productPath, storefrontOrigin).toString(),
    ...(compareAtPrice !== undefined && compareAtPrice > Number(product.displayPrice)
      ? { compareAtPrice }
      : {}),
    ...(description ? { description } : {}),
    ...(shortDescription ? { shortDescription } : {}),
    ...(story ? { story } : {}),
    ...(careInstructions ? { careInstructions } : {}),
    ...(barcode ? { barcode } : {}),
    ...(sku ? { sku } : {}),
    ...(suggestedCategoryName ? { suggestedCategoryName } : {}),
    ...(categoryPath && categoryPath.length > 0 ? { categoryPath } : {}),
    ...(stockQuantity !== undefined ? { stockQuantity } : {}),
    ...(variants && variants.length > 0 ? { variants } : {}),
  }
}

async function fetchCatalogPage(designerSlug: string, page: number) {
  const response = await fetch(`${HIPICON_API_ORIGIN}/designers/products/${designerSlug}?page=${page}`, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Hipicon katalog sayfası alınamadı: ${response.status}`)
  }

  const payload = (await response.json()) as HipiconCatalogResponse
  return {
    items: payload.data?.productList ?? [],
    totalProductCount:
      payload.data?.productListDetail?.totalProductCount ?? payload.data?.productList?.length ?? 0,
    totalPageCount: payload.data?.productListDetail?.totalPageCount ?? 1,
  }
}

async function fetchProductDetail(productId: string): Promise<HipiconProductDetail | null> {
  try {
    const response = await fetch(`${HIPICON_API_ORIGIN}/products/${productId}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!response.ok) return null
    const payload = (await response.json()) as HipiconProductDetail | HipiconProductDetailResponse
    if ('data' in payload) return payload.data ?? null
    return payload as HipiconProductDetail
  } catch {
    return null
  }
}

async function assertRobotsAllowed(url: URL) {
  const robotsUrl = `${url.origin}/robots.txt`
  const response = await fetch(robotsUrl, {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!response.ok) return
  const text = await response.text()
  if (text.includes(`Disallow: ${url.pathname}`)) {
    throw new Error('Hipicon bu URL için scraping izni vermiyor.')
  }
}

// Fetch product details in batches to enrich list data.
// Capped at MAX_DETAIL_FETCHES to avoid excessive latency.
const MAX_DETAIL_FETCHES = 30

async function enrichWithDetails(
  products: HipiconProduct[],
): Promise<Map<string, HipiconProductDetail>> {
  const detailMap = new Map<string, HipiconProductDetail>()
  const toFetch = products.slice(0, MAX_DETAIL_FETCHES)

  for (const product of toFetch) {
    await sleep(200)
    const detail = await fetchProductDetail(product.id)
    if (detail) detailMap.set(product.id, detail)
  }

  return detailMap
}

export class HipiconAdapter implements ImportAdapter {
  name = 'hipicon'

  supports(url: string) {
    try {
      const parsed = new URL(url)
      return ['hipicon.com', 'www.hipicon.com'].includes(parsed.hostname)
    } catch {
      return false
    }
  }

  async fetchProducts(url: string): Promise<ScrapedProductCollection> {
    const parsedUrl = new URL(url)
    await assertRobotsAllowed(parsedUrl)
    await sleep(500)

    const storefrontResponse = await fetch(parsedUrl.toString(), {
      headers: { 'User-Agent': USER_AGENT },
    })

    if (!storefrontResponse.ok) {
      throw new Error(`Hipicon mağazası okunamadı: ${storefrontResponse.status}`)
    }

    const resolvedUrl = new URL(storefrontResponse.url || parsedUrl.toString())
    const designerSlug = getDesignerSlug(resolvedUrl)
    const firstPage = await fetchCatalogPage(designerSlug, 1)
    const totalPages = Math.max(1, firstPage.totalPageCount)
    const totalCount = Math.max(firstPage.totalProductCount, firstPage.items.length)
    const seenIds = new Set<string>()
    const rawItems: HipiconProduct[] = []
    let warning: string | undefined

    const collectProducts = (products: HipiconProduct[]) => {
      for (const product of products) {
        if (seenIds.has(product.id)) continue
        seenIds.add(product.id)
        rawItems.push(product)
      }
    }

    collectProducts(firstPage.items)

    for (let page = 2; page <= totalPages; page += 1) {
      await sleep(250)

      try {
        const nextPage = await fetchCatalogPage(designerSlug, page)
        collectProducts(nextPage.items)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Bilinmeyen hata'
        warning = `Kaynak mağazanın ${page}. sayfası alınamadı. Önizleme kısmi olabilir. (${detail})`
        break
      }
    }

    // Best-effort enrichment: fetch product details for richer fields.
    const detailMap = await enrichWithDetails(rawItems).catch(() => new Map<string, HipiconProductDetail>())

    const items: ScrapedProduct[] = rawItems.map((product) =>
      normalizeProduct(product, resolvedUrl.origin, detailMap.get(product.id) ?? null),
    )

    const fetchedCount = items.length
    const isPartial = Boolean(warning) || fetchedCount < totalCount

    return {
      items,
      fetchedCount,
      totalCount,
      isPartial,
      ...(warning ? { warning } : {}),
    }
  }
}
