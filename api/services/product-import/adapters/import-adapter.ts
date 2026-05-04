export interface ScrapedProductVariant {
  name: string
  barcode?: string
  price?: number
  compareAtPrice?: number
  stockQuantity?: number
}

export interface ScrapedProduct {
  externalId: string
  name: string
  price: number
  compareAtPrice?: number
  description?: string
  shortDescription?: string
  story?: string
  careInstructions?: string
  imageUrls: string[]
  externalUrl: string
  barcode?: string
  sku?: string
  suggestedCategoryName?: string
  categoryPath?: string[]
  stockQuantity?: number
  proposedBarcode?: string
  variants?: ScrapedProductVariant[]
}

export interface ScrapedProductCollection {
  items: ScrapedProduct[]
  fetchedCount: number
  totalCount: number
  isPartial: boolean
  warning?: string
}

export interface ImportAdapter {
  name: string
  supports(url: string): boolean
  fetchProducts(url: string): Promise<ScrapedProductCollection>
}
