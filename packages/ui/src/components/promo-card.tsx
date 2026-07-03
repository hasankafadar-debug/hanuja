import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { isManagedMediaProxyUrl, mediaSrcSet } from '../lib/media-url'

export interface PromoCardProps {
  imageUrl: string
  imageVariants?: unknown
  imageAlt: string
  title: string
  subtitle?: string | null
  ctaHref: string
  priority?: boolean
}

export function PromoCard({
  imageUrl,
  imageVariants,
  imageAlt,
  title,
  subtitle,
  ctaHref,
  priority = false,
}: PromoCardProps) {
  const { src, srcSet, sizes } = mediaSrcSet(imageVariants ?? null, imageUrl)
  const useUnoptimizedImage = isManagedMediaProxyUrl(src)

  return (
    <Link
      href={ctaHref}
      className="group relative flex-1 overflow-hidden rounded-xl"
      style={{ minHeight: '140px' }}
    >
      {/* Background image */}
      <Image
        src={src}
        alt={imageAlt}
        fill
        className="object-cover transition-transform duration-500 group-hover:scale-105"
        priority={priority}
        sizes={sizes ?? '(max-width: 768px) 50vw, 33vw'}
        unoptimized={useUnoptimizedImage}
        {...(srcSet ? { srcSet } : {})}
      />

      {/* Overlay */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to top, rgba(26,26,24,0.72) 0%, rgba(26,26,24,0.20) 60%, transparent 100%)',
        }}
      />

      {/* Content */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-4">
        <p
          className="text-sm font-semibold leading-snug"
          style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-primary-fg)' }}
        >
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-xs" style={{ color: 'rgba(232,226,212,0.75)' }}>
            {subtitle}
          </p>
        )}
        <span
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium transition-colors group-hover:opacity-90"
          style={{ color: 'var(--color-accent)' }}
        >
          Keşfet <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  )
}
