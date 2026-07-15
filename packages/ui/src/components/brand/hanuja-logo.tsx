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
      {/* buyuk blok - sol ust */}
      <rect x="2" y="2" width="22" height="14" fill={fg} opacity="0.92" />
      {/* kucuk kare - sag ust */}
      <rect x="28" y="2" width="14" height="14" fill="none" stroke={fg} strokeWidth="1.4" />
      {/* ince yatay serit - sol alt, accent rengi */}
      <rect x="2" y="22" width="14" height="5" fill={ac} />
      {/* orta boy blok - sag alt */}
      <rect x="20" y="20" width="22" height="22" fill="none" stroke={fg} strokeWidth="1.4" />
      {/* kucuk nokta aksan - sol en alt */}
      <rect x="2" y="32" width="8" height="10" fill={fg} opacity="0.35" />
    </svg>
  )
}

export interface HanujaLogoProps {
  /** Olcek carpani (default 1) */
  scale?: number
  /** Sadece metin blogu icin ayri olcek carpani */
  textScale?: number
  /** Zemin turu - logo rengini belirler */
  variant?: 'light' | 'dark'
  /** Sadece sembol - favicon, mobil header */
  compact?: boolean
  /** Kelime markasinin altindaki slogan gosterilsin mi? */
  showTagline?: boolean
  className?: string
}

/**
 * Hanuja marka logosu.
 *
 * CSS custom property'lerinden renk okur; brand swap otomatik calisir.
 * variant='dark' -> krem ustune koyu zemin (header, footer dark bolge).
 * variant='light' -> koyu ustune acik zemin (varsayilan).
 */
export function HanujaLogo({
  scale = 1,
  textScale = 1,
  variant = 'light',
  compact = false,
  showTagline = true,
  className,
}: HanujaLogoProps) {
  const fg = variant === 'dark' ? 'var(--color-primary-fg)' : 'var(--color-primary)'
  const ac = 'var(--color-accent)'
  const taglineColor = variant === 'dark' ? ac : 'var(--color-secondary)'
  // HANUJA kelime markasi %10 kucultuldu; hemen solundaki sembol %20 buyutuldu.
  const wordmarkShrink = 0.9
  const symbolScale = scale * 1.2
  const textGap = 4 * scale * textScale
  const wordmarkFontSize = 26 * scale * textScale * wordmarkShrink
  const wordmarkLetterSpacing = 9 * scale * textScale * wordmarkShrink
  const taglineFontSize = 7.5 * scale * textScale
  const taglineLetterSpacing = 4 * scale * textScale

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
      <HanujaSymbol scale={symbolScale} fg={fg} ac={ac} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: textGap, alignItems: 'center' }}>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 200,
            fontSize: wordmarkFontSize,
            letterSpacing: wordmarkLetterSpacing,
            color: fg,
            lineHeight: 1,
            textTransform: 'uppercase',
          }}
        >
          hanuja
        </span>
        {showTagline ? (
          <span
            style={{
              fontFamily: 'var(--font-body, var(--font-sans))',
              fontWeight: 300,
              fontSize: taglineFontSize,
              letterSpacing: taglineLetterSpacing,
              color: taglineColor,
              textTransform: 'uppercase',
            }}
          >
            curated living
          </span>
        ) : null}
      </span>
    </span>
  )
}
