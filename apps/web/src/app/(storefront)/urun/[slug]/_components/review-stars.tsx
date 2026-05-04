import { Star } from 'lucide-react'

interface Props {
  /** 1-5 rating; 0 or null = no fill */
  value: number
  size?: number
  className?: string
}

export function ReviewStars({ value, size = 16, className }: Props) {
  const safe = Math.max(0, Math.min(5, value))
  return (
    <div className={className} style={{ display: 'inline-flex', gap: 2 }} aria-label={`${safe} / 5 yıldız`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= Math.round(safe)
        return (
          <Star
            key={i}
            width={size}
            height={size}
            fill={filled ? 'currentColor' : 'none'}
            strokeWidth={1.5}
            style={{ color: filled ? '#f5b301' : 'var(--color-muted-fg)' }}
          />
        )
      })}
    </div>
  )
}
