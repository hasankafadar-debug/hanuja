import Image from 'next/image'
import { isManagedMediaProxyUrl, normalizeMediaDisplayUrl } from '@hanuja/ui'

export function QuestionProductThumb({
  imageUrl,
  alt,
  size = 56,
}: {
  imageUrl: string | null
  alt: string
  size?: number
}) {
  const src = imageUrl ? normalizeMediaDisplayUrl(imageUrl) : null
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-lg"
      style={{ width: size, height: size, backgroundColor: 'var(--color-muted)' }}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={`${size}px`}
          className="object-cover"
          unoptimized={isManagedMediaProxyUrl(src)}
        />
      ) : null}
    </div>
  )
}
