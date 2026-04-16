/**
 * ProductCard — storefront product card with image, title, price, badge, and CTA.
 * Used in category pages, search results, and curated collections.
 */
"use client"

import * as React from "react"
import { ShoppingCart } from "lucide-react"
import { cn } from "../../lib/utils"
import { Badge } from "../badge"
import { Button } from "../button"

export interface ProductCardProps {
  id: string
  title: string
  slug: string
  imageUrl?: string | null
  price: number
  comparePrice?: number | null
  sellerName?: string
  sellerSlug?: string
  badge?: string
  badgeVariant?: "default" | "secondary" | "success" | "warning" | "destructive"
  onAddToCart?: (id: string) => void
  href?: string
  className?: string
}

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amount)
}

function ProductCard({
  id,
  title,
  slug,
  imageUrl,
  price,
  comparePrice,
  sellerName,
  sellerSlug,
  badge,
  badgeVariant = "default",
  onAddToCart,
  href,
  className,
}: ProductCardProps) {
  const cardHref = href ?? `/urun/${slug}`
  const hasDiscount = comparePrice != null && comparePrice > price
  const discountPct = hasDiscount
    ? Math.round(((comparePrice! - price) / comparePrice!) * 100)
    : 0

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-shadow hover:shadow-md",
        className
      )}
    >
      {/* Image */}
      <a href={cardHref} className="block aspect-[4/3] overflow-hidden bg-muted">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-fg text-xs">
            Görsel yok
          </div>
        )}
        {badge && (
          <div className="absolute left-2 top-2">
            <Badge variant={badgeVariant}>{badge}</Badge>
          </div>
        )}
        {hasDiscount && (
          <div className="absolute right-2 top-2">
            <Badge variant="destructive">-%{discountPct}</Badge>
          </div>
        )}
      </a>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {sellerName && (
          <a
            href={sellerSlug ? `/magaza/${sellerSlug}` : "#"}
            className="text-xs text-muted-fg hover:text-primary transition-colors truncate"
            onClick={(e) => e.stopPropagation()}
          >
            {sellerName}
          </a>
        )}

        <a href={cardHref} className="block">
          <h3 className="text-sm font-medium leading-snug line-clamp-2 hover:text-primary transition-colors">
            {title}
          </h3>
        </a>

        <div className="mt-auto flex items-end justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-base font-semibold text-primary">
              {formatPrice(price)}
            </span>
            {hasDiscount && (
              <span className="text-xs text-muted-fg line-through">
                {formatPrice(comparePrice!)}
              </span>
            )}
          </div>

          {onAddToCart && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.preventDefault()
                onAddToCart(id)
              }}
              aria-label={`Sepete ekle: ${title}`}
            >
              <ShoppingCart className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export { ProductCard }
