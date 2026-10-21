import type { Prisma } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

/**
 * Public projection for the unauthenticated storefront product API
 * (GET /api/products and GET /api/products/:slug).
 *
 * This is an allowlist of fields the storefront product page already shows.
 * Seller account fields (commissionRateOverride, userId, ...), moderation
 * records, SKU/barcode, the seller's internal modelCode and category admin
 * metadata must never be added here. Values pass through unchanged, so prices
 * stay the effective (discounted) price the catalog service resolved.
 */

type PublicProductImageInput = {
  url: string
  altText: string | null
  sortOrder: number
  isPrimary: boolean
}

export type PublicProductSummaryInput = {
  id: string
  slug: string
  name: string
  brand: string
  description: string | null
  shortDescription: string | null
  story: string | null
  careInstructions: string | null
  price: Decimal
  compareAtPrice: Decimal | null
  fulfillmentDays: number
  stockQuantity: number
  categoryId: string | null
  dimensionLength: Decimal | null
  dimensionWidth: Decimal | null
  dimensionHeight: Decimal | null
  properties: Prisma.JsonValue
  avgRating: Decimal | null
  reviewCount: number
  images: PublicProductImageInput[]
  seller: { slug: string; displayName: string }
}

export type PublicProductDetailInput = PublicProductSummaryInput & {
  category: { id: string; slug: string; name: string } | null
  variants: Array<{
    id: string
    name: string
    price: Decimal | null
    compareAtPrice: Decimal | null
    stockQuantity: number
    options: Prisma.JsonValue
  }>
  attributeValues: Array<{
    sortOrder: number
    option: { type: string; label: string; hexColor: string | null }
  }>
}

export function toPublicProductSummary(product: PublicProductSummaryInput) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    description: product.description,
    shortDescription: product.shortDescription,
    story: product.story,
    careInstructions: product.careInstructions,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    fulfillmentDays: product.fulfillmentDays,
    stockQuantity: product.stockQuantity,
    categoryId: product.categoryId,
    dimensionLength: product.dimensionLength,
    dimensionWidth: product.dimensionWidth,
    dimensionHeight: product.dimensionHeight,
    properties: product.properties,
    avgRating: product.avgRating,
    reviewCount: product.reviewCount,
    images: product.images.map((image) => ({
      url: image.url,
      altText: image.altText,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),
    seller: {
      slug: product.seller.slug,
      displayName: product.seller.displayName,
    },
  }
}

export function toPublicProductDetail(product: PublicProductDetailInput) {
  return {
    ...toPublicProductSummary(product),
    category: product.category
      ? { id: product.category.id, slug: product.category.slug, name: product.category.name }
      : null,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      stockQuantity: variant.stockQuantity,
      options: variant.options,
    })),
    attributeValues: product.attributeValues.map((attribute) => ({
      sortOrder: attribute.sortOrder,
      option: {
        type: attribute.option.type,
        label: attribute.option.label,
        hexColor: attribute.option.hexColor,
      },
    })),
  }
}
