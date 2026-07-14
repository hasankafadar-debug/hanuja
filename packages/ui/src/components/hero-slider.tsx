'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { isManagedMediaProxyUrl, mediaSrcSet, normalizeMediaDisplayUrl } from '../lib/media-url'

export interface HeroSlide {
  id: string
  sortOrder: number
  mediaAsset: {
    id: string
    kind: string
    url: string
    variants: unknown
    durationSec: number | null
  }
  posterAsset: {
    id: string
    url: string
    variants: unknown
  } | null
  eyebrow: string | null
  title: string
  body: string | null
  ctaLabel: string
  ctaHref: string
  sellerId?: string | null
}

export interface HeroSliderProps {
  slides: HeroSlide[]
  autoPlayMs?: number
  loop?: boolean
}

export function HeroSlider({ slides, autoPlayMs = 6000, loop = true }: HeroSliderProps) {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const count = slides.length

  const prev = useCallback(() => {
    setCurrent((c) => (c === 0 ? (loop ? count - 1 : 0) : c - 1))
  }, [count, loop])

  const next = useCallback(() => {
    setCurrent((c) => (c === count - 1 ? (loop ? 0 : count - 1) : c + 1))
  }, [count, loop])

  // Auto-rotate — disabled when paused or single slide or prefers-reduced-motion
  useEffect(() => {
    if (count <= 1 || paused) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mq.matches) return
    const id = setInterval(next, autoPlayMs)
    return () => clearInterval(id)
  }, [count, paused, autoPlayMs, next])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prev, next])

  if (count === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl h-full"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        <Link
          href="/kategori/mobilya"
          className="inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
        >
          Koleksiyonu Keşfet
        </Link>
      </div>
    )
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl h-full"
      style={{ backgroundColor: 'var(--color-primary)' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
        if (Math.abs(dx) > 40) dx < 0 ? next() : prev()
        touchStartX.current = null
      }}
      aria-roledescription="carousel"
      aria-label="Ana sayfa hero slider"
    >
      {/* Slides */}
      {slides.map((slide, i) => {
        const isVideo = slide.mediaAsset.kind === 'VIDEO' || slide.mediaAsset.kind === 'video'
        const posterSrc = slide.posterAsset
          ? mediaSrcSet(slide.posterAsset.variants, slide.posterAsset.url).src
          : undefined
        const imgMeta = mediaSrcSet(slide.mediaAsset.variants, slide.mediaAsset.url)
        const videoSrc = normalizeMediaDisplayUrl(slide.mediaAsset.url)
        const useUnoptimizedImage = isManagedMediaProxyUrl(imgMeta.src)

        return (
          <div
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} / ${count}`}
            aria-hidden={i !== current}
            className="absolute inset-0 transition-opacity duration-700"
            style={{ opacity: i === current ? 1 : 0, pointerEvents: i === current ? 'auto' : 'none' }}
          >
            {/* Background media */}
            {isVideo ? (
              <video
                className="absolute inset-0 h-full w-full object-cover"
                src={videoSrc}
                poster={posterSrc}
                autoPlay
                muted
                loop
                playsInline
                aria-hidden="true"
              />
            ) : (
              <Image
                src={imgMeta.src}
                alt={slide.title}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 768px) 100vw, 66vw"
                unoptimized={useUnoptimizedImage}
                {...(imgMeta.srcSet ? { srcSet: imgMeta.srcSet } : {})}
              />
            )}

            {/* Gradient overlay */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(to right, rgba(26,26,24,0.80) 0%, rgba(26,26,24,0.40) 60%, transparent 100%)',
              }}
            />

            {/* Content */}
            <div className="relative z-10 flex h-full flex-col justify-end p-8 sm:p-10">
              {slide.eyebrow && (
                <p
                  className="mb-3 text-xs font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {slide.eyebrow}
                </p>
              )}
              <h2
                className="text-3xl font-light leading-tight sm:text-4xl lg:text-5xl"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary-fg)' }}
              >
                {slide.title}
              </h2>
              {slide.body && (
                <p
                  className="mt-3 max-w-sm text-sm leading-relaxed sm:text-base"
                  style={{ color: 'rgba(232,226,212,0.75)' }}
                >
                  {slide.body}
                </p>
              )}
              <div className="mt-6">
                <Link
                  href={slide.ctaHref}
                  className="inline-flex items-center gap-2 rounded-full px-7 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
                >
                  {slide.ctaLabel}
                </Link>
              </div>
            </div>
          </div>
        )
      })}

      {/* Prev / Next — only when count > 1 */}
      {count > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="Önceki slayt"
            className="absolute left-3 top-1/2 z-20 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full transition-colors"
            style={{ backgroundColor: 'rgba(26,26,24,0.45)', color: 'var(--color-primary-fg)' }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={next}
            aria-label="Sonraki slayt"
            className="absolute right-3 top-1/2 z-20 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full transition-colors"
            style={{ backgroundColor: 'rgba(26,26,24,0.45)', color: 'var(--color-primary-fg)' }}
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* Dots */}
          <div
            className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2"
            aria-live="polite"
            aria-atomic="true"
          >
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                aria-label={`Slayt ${i + 1}`}
                aria-current={i === current ? 'true' : undefined}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === current ? '2rem' : '0.375rem',
                  backgroundColor:
                    i === current ? 'var(--color-accent)' : 'rgba(232,226,212,0.45)',
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
