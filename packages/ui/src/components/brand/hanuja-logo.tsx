import * as React from 'react'

interface SymbolProps {
  scale?: number
  fg: string
  ac: string
}

function HanujaSymbol({ scale = 1, fg, ac }: SymbolProps) {
  const s = scale
  return (
    <svg width={44 * s} height={44 * s} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      {/* büyük blok — sol üst */}
      <rect x="2" y="2" width="22" height="14" fill={fg} opacity="0.92" />
      {/* küçük kare — sağ üst */}
      <rect x="28" y="2" width="14" height="14" fill="none" stroke={fg} strokeWidth="1.4" />
      {/* ince yatay şerit — sol alt, accent rengi */}
      <rect x="2" y="22" width="14" height="5" fill={ac} />
      {/* orta boy blok — sağ alt */}
      <rect x="20" y="20" width="22" height="22" fill="none" stroke={fg} strokeWidth="1.4" />
      {/* küçük nokta aksan — sol en alt */}
      <rect x="2" y="32" width="8" height="10" fill={fg} opacity="0.35" />
    </svg>
  )
}

export interface HanujaLogoProps {
  /** Ölçek çarpanı (default 1) */
  scale?: number
  /** Zemin türü — logo rengini belirler */
  variant?: 'light' | 'dark'
  /** Sadece sembol — favicon, mobil header */
  compact?: boolean
  className?: string
}

/**
 * Hanuja marka logosu.
 *
 * CSS custom property'lerinden renk okur; brand swap otomatik çalışır.
 * variant='dark' → krem üstüne koyu zemin (header, footer dark bölge).
 * variant='light' → koyu üstüne açık zemin (varsayılan).
 */
export function HanujaLogo({
  scale = 1,
  variant = 'light',
  compact = false,
  className,
}: HanujaLogoProps) {
  const fg = variant === 'dark' ? 'var(--color-primary-fg)' : 'var(--color-primary)'
  const ac = 'var(--color-accent)'
  const taglineColor = variant === 'dark' ? ac : 'var(--color-secondary)'

  if (compact) {
    return (
      <span className={className} aria-label="Hanuja">
        <HanujaSymbol scale={scale} fg={fg} ac={ac} />
      </span>
    )
  }

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 18 * scale }}
      aria-label="Hanuja"
    >
      <HanujaSymbol scale={scale} fg={fg} ac={ac} />
      <span
        style={{ display: 'flex', flexDirection: 'column', gap: 4 * scale, alignItems: 'center' }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 200,
            fontSize: 26 * scale,
            letterSpacing: 9 * scale,
            color: fg,
            lineHeight: 1,
            textTransform: 'uppercase',
          }}
        >
          hanuja
        </span>
        <span
          style={{
            fontFamily: 'var(--font-body, var(--font-sans))',
            fontWeight: 300,
            fontSize: 7.5 * scale,
            letterSpacing: 4 * scale,
            color: taglineColor,
            textTransform: 'uppercase',
          }}
        >
          curated living
        </span>
      </span>
    </span>
  )
}
