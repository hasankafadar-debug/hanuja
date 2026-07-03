'use client'

import { useState } from 'react'
import Image from 'next/image'
import { isManagedMediaProxyUrl, normalizeMediaDisplayUrl } from '@hanuja/ui'

interface ProductGalleryProps {
  images: Array<{ url: string; altText: string | null }>
  productName: string
}

export default function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeImage = images[activeIndex] ?? images[0]
  const activeImageUrl = activeImage ? normalizeMediaDisplayUrl(activeImage.url) : null

  if (!activeImage) {
    return (
      <div
        className="aspect-square w-full rounded-xl flex items-center justify-center text-sm"
        style={{
          backgroundColor: 'var(--color-muted)',
          color: 'var(--color-muted-fg)',
          border: '1px solid var(--color-border)',
        }}
      >
        Ürün Görseli — {productName}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl">
        <Image
          src={activeImageUrl!}
          alt={activeImage.altText ?? productName}
          fill
          className="object-cover"
          priority
          unoptimized={Boolean(activeImageUrl && isManagedMediaProxyUrl(activeImageUrl))}
        />
      </div>

      {images.length > 1 && (
        <div className="grid grid-cols-4 gap-2">
          {images.slice(0, 4).map((image, index) => {
            const isActive = index === activeIndex
            const imageUrl = normalizeMediaDisplayUrl(image.url)
            return (
              <button
                key={`${image.url}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className="relative aspect-square overflow-hidden rounded-lg border transition"
                style={{
                  borderColor: isActive ? 'var(--color-accent)' : 'var(--color-border)',
                  boxShadow: isActive ? '0 0 0 1px var(--color-accent)' : undefined,
                }}
              >
                <Image
                  src={imageUrl}
                  alt={image.altText ?? productName}
                  fill
                  className="object-cover"
                  unoptimized={isManagedMediaProxyUrl(imageUrl)}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
