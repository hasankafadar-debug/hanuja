'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { isManagedMediaProxyUrl, normalizeMediaDisplayUrl } from '@hanuja/ui'

const MAX_ZOOM = 3

interface ProductGalleryProps {
  images: Array<{ url: string; altText: string | null }>
  productName: string
}

export default function ProductGallery({
  images,
  productName,
}: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [supportsZoom, setSupportsZoom] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [hasZoomed, setHasZoomed] = useState(false)
  const zoomLayerRef = useRef<HTMLDivElement>(null)
  const activeImage = images[activeIndex] ?? images[0]
  const activeImageUrl = activeImage
    ? normalizeMediaDisplayUrl(activeImage.url)
    : null

  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)')
    const sync = () => {
      setSupportsZoom(media.matches)
      if (!media.matches) setZoom(1)
    }
    sync()
    media.addEventListener('change', sync)
    const reset = () => setZoom(1)
    window.addEventListener('blur', reset)
    return () => {
      media.removeEventListener('change', sync)
      window.removeEventListener('blur', reset)
    }
  }, [])

  useEffect(() => {
    setZoom(1)
    setHasZoomed(false)
  }, [activeImageUrl])

  function moveOrigin(clientX?: number, clientY?: number) {
    const layer = zoomLayerRef.current
    const frame = layer?.parentElement
    if (!layer || !frame) return
    const rect = frame.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x =
      clientX === undefined
        ? 50
        : Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
    const y =
      clientY === undefined
        ? 50
        : Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100))
    // Changing the origin pans the scaled image without revealing empty edges.
    layer.style.transformOrigin = `${x}% ${y}%`
  }

  function cycleZoom(clientX?: number, clientY?: number) {
    if (!supportsZoom) return
    moveOrigin(clientX, clientY)
    setHasZoomed(true)
    setZoom((current) => (current === 1 ? 1.5 : current === 1.5 ? MAX_ZOOM : 1))
  }

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
      <div
        role={supportsZoom ? 'button' : undefined}
        tabIndex={supportsZoom ? 0 : undefined}
        aria-label={
          supportsZoom
            ? `${productName} — ${zoom === MAX_ZOOM ? 'Yakınlaştırmayı sıfırla' : 'Görseli yakınlaştır'}`
            : undefined
        }
        aria-pressed={supportsZoom ? zoom > 1 : undefined}
        data-testid="product-gallery-main"
        className={`group relative aspect-square w-full overflow-hidden rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-primary)] ${supportsZoom ? (zoom === MAX_ZOOM ? 'cursor-zoom-out' : 'cursor-zoom-in') : ''}`}
        onClick={(event) =>
          cycleZoom(
            event.detail === 0 ? undefined : event.clientX,
            event.detail === 0 ? undefined : event.clientY,
          )
        }
        onPointerMove={(event) => {
          if (supportsZoom && event.pointerType !== 'touch' && zoom > 1)
            moveOrigin(event.clientX, event.clientY)
        }}
        onPointerLeave={() => setZoom(1)}
        onBlur={() => setZoom(1)}
        onKeyDown={(event) => {
          if (!supportsZoom) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            cycleZoom()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setZoom(1)
          }
        }}
      >
        <div
          ref={zoomLayerRef}
          className="absolute inset-0 transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ transform: `scale(${zoom})` }}
        >
          <Image
            src={activeImageUrl!}
            alt={activeImage.altText ?? productName}
            fill
            sizes={
              hasZoomed
                ? '(max-width: 1023px) 300vw, 1920px'
                : '(max-width: 1023px) 100vw, 640px'
            }
            className="object-cover"
            priority
            draggable={false}
            unoptimized={Boolean(
              activeImageUrl && isManagedMediaProxyUrl(activeImageUrl),
            )}
          />
        </div>
        {supportsZoom && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-opacity duration-150 motion-reduce:transition-none ${zoom > 1 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-primary)',
            }}
          >
            {zoom === MAX_ZOOM ? (
              <ZoomOut className="h-3.5 w-3.5" />
            ) : (
              <ZoomIn className="h-3.5 w-3.5" />
            )}
            {zoom === 1 ? 'Yakınlaştır' : `${zoom.toLocaleString('tr-TR')}×`}
          </span>
        )}
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
                onClick={() => {
                  setZoom(1)
                  setActiveIndex(index)
                }}
                aria-label={`${productName} — ${index + 1}. görsel`}
                aria-pressed={isActive}
                className="relative aspect-square overflow-hidden rounded-lg border transition"
                style={{
                  borderColor: isActive
                    ? 'var(--color-accent)'
                    : 'var(--color-border)',
                  boxShadow: isActive
                    ? '0 0 0 1px var(--color-accent)'
                    : undefined,
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
