/**
 * ProductCard — storefront product card with image, title, price, badge, and CTA.
 * Used in category pages, search results, and curated collections.
 */
"use client"

import * as React from "react"
import Image from "next/image"
import { Heart, ShoppingCart } from "lucide-react"
import { cn } from "../../lib/utils"
import { normalizeMediaDisplayUrl } from "../../lib/media-url"
import { Badge } from "../badge"
import { Button } from "../button"

export interface ProductCardProps {
  id: string
  title: string
  slug: string
  imageUrl?: string | null
  imageUrls?: string[]
  price: number
  comparePrice?: number | null
  sellerName?: string
  sellerSlug?: string
  badge?: string
  badgeVariant?: "default" | "secondary" | "success" | "warning" | "destructive"
  onAddToCart?: (id: string) => void
  onToggleFavorite?: (id: string, nextState: boolean) => void
  isFavorited?: boolean
  favoriteLoading?: boolean
  href?: string
  className?: string
  priority?: boolean
}

function formatPrice(amount: number): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amount)
}

function ProductCard({
  id,
  title,
  slug,
  imageUrl,
  imageUrls,
  price,
  comparePrice,
  sellerName,
  sellerSlug,
  badge,
  badgeVariant = "default",
  onAddToCart,
  onToggleFavorite,
  isFavorited = false,
  favoriteLoading = false,
  href,
  className,
  priority = false,
}: ProductCardProps) {
  const cardHref = href ?? `/urun/${slug}`
  const hasDiscount = comparePrice != null && comparePrice > price
  const discountPct = hasDiscount
    ? Math.round(((comparePrice! - price) / comparePrice!) * 100)
    : 0
  const [supportsHover, setSupportsHover] = React.useState(true)
  const allUrls = [...(imageUrls ?? []), ...(imageUrl ? [imageUrl] : [])]
  const gallery = Array.from(
    new Set(allUrls.filter((value): value is string => Boolean(value)).map((value) => normalizeMediaDisplayUrl(value)))
  )
  const [activeImageIndex, setActiveImageIndex] = React.useState(0)

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return

    const media = window.matchMedia("(hover: hover) and (pointer: fine)")
    const sync = () => setSupportsHover(media.matches)
    sync()

    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  React.useEffect(() => {
    setActiveImageIndex(0)
  }, [gallery.length, id])

  const activeImageUrl = gallery[activeImageIndex] ?? null
  const favoriteButtonClassName = supportsHover
    ? isFavorited
      ? "opacity-70 group-hover:opacity-100"
      : "opacity-0 group-hover:opacity-100"
    : "opacity-100"

  function handleImageMouseMove(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!supportsHover || gallery.length <= 1) return

    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return

    const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
    const ratio = offsetX / rect.width
    const nextIndex = Math.min(gallery.length - 1, Math.floor(ratio * gallery.length))
    setActiveImageIndex(nextIndex)
  }

  function handleImageMouseLeave() {
    if (gallery.length <= 1) return
    setActiveImageIndex(0)
  }

  return (
    <div
      data-testid="product-card"
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-shadow hover:shadow-md",
        className
      )}
    >
      <div className="relative">
        <a
          href={cardHref}
          className="relative block aspect-[4/3] overflow-hidden bg-muted"
          onMouseMove={handleImageMouseMove}
          onMouseLeave={handleImageMouseLeave}
        >
          {activeImageUrl ? (
            <Image
              src={activeImageUrl}
              alt={title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              priority={priority}
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

        {onToggleFavorite && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={cn(
              "absolute bottom-3 right-3 z-10 rounded-full border border-white/70 bg-white/90 px-2.5 shadow-sm backdrop-blur transition-opacity hover:bg-white",
              favoriteButtonClassName
            )}
            aria-label={isFavorited ? `Favorilerden çıkar: ${title}` : `Favorilere ekle: ${title}`}
            aria-pressed={isFavorited}
            disabled={favoriteLoading}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onToggleFavorite(id, !isFavorited)
            }}
          >
            <Heart
              className={cn(
                "h-4 w-4",
                isFavorited ? "fill-[var(--color-accent)] text-[var(--color-accent)]" : "text-[var(--color-primary)]"
              )}
            />
          </Button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {sellerName && (
          <a
            href={sellerSlug ? `/magaza/${sellerSlug}` : "#"}
            className="text-xs text-muted-fg hover:text-primary transition-colors truncate"
            onClick={(event) => event.stopPropagation()}
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
              onClick={(event) => {
                event.preventDefault()
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
