'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label } from '@hanuja/ui'
import ImageUploader from '@/components/image-uploader'

type BannerMode = 'image' | 'color'
type FontSize = 'sm' | 'md' | 'lg' | 'xl'

interface Props {
  logoUrl: string | null
  bannerUrl: string | null
  bannerColor: string | null
  bannerHeadline: string | null
  bannerTextColor: string | null
  bannerHeadlineFontSize: string | null
}

const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: 'sm', label: 'Küçük' },
  { value: 'md', label: 'Orta' },
  { value: 'lg', label: 'Büyük' },
  { value: 'xl', label: 'Çok Büyük' },
]

const PRESET_COLORS = [
  '#1a1a2e', '#16213e', '#0f3460', '#533483',
  '#2d6a4f', '#1b4332', '#6b2737', '#3d405b',
]

const PRESET_TEXT_COLORS = ['#ffffff', '#f5f5f5', '#111111', '#ffd700', '#a8dadc']

export default function StoreBrandForm({
  logoUrl: initialLogoUrl,
  bannerUrl: initialBannerUrl,
  bannerColor: initialBannerColor,
  bannerHeadline: initialBannerHeadline,
  bannerTextColor: initialBannerTextColor,
  bannerHeadlineFontSize: initialFontSize,
}: Props) {
  const router = useRouter()

  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
  const [bannerMode, setBannerMode] = useState<BannerMode>(initialBannerUrl ? 'image' : 'color')
  const [bannerUrl, setBannerUrl] = useState<string | null>(initialBannerUrl)
  const [bannerColor, setBannerColor] = useState(initialBannerColor ?? '#1a1a2e')
  const [bannerHeadline, setBannerHeadline] = useState(initialBannerHeadline ?? '')
  const [bannerTextColor, setBannerTextColor] = useState(initialBannerTextColor ?? '#ffffff')
  const [fontSize, setFontSize] = useState<FontSize>((initialFontSize as FontSize) ?? 'md')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const fontSizePreview: Record<FontSize, string> = {
    sm: '14px',
    md: '18px',
    lg: '24px',
    xl: '32px',
  }

  async function handleSave() {
    setLoading(true)
    setError(null)
    setSaved(false)

    try {
      const payload: Record<string, string | null | undefined> = {
        logoUrl: logoUrl ?? undefined,
      }

      if (bannerMode === 'image') {
        payload.bannerUrl = bannerUrl ?? undefined
        payload.bannerColor = undefined
        payload.bannerHeadline = undefined
        payload.bannerTextColor = undefined
        payload.bannerHeadlineFontSize = undefined
      } else {
        payload.bannerUrl = undefined
        payload.bannerColor = bannerColor
        payload.bannerHeadline = bannerHeadline || undefined
        payload.bannerTextColor = bannerTextColor
        payload.bannerHeadlineFontSize = fontSize
      }

      // Remove undefined keys so they don't overwrite other fields
      const body = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined),
      )

      const res = await fetch('/api/seller/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Bir hata oluştu.')
      } else {
        setSaved(true)
        router.refresh()
      }
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Logo */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>Mağaza Logosu</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>
            Kare görsel önerilir (min. 200×200 px). PNG veya JPEG.
          </p>
        </div>
        <ImageUploader
          value={logoUrl}
          onUpload={setLogoUrl}
          folder="avatars"
          label="Logo"
          disabled={loading}
        />
        {logoUrl && (
          <button
            type="button"
            className="text-xs underline"
            style={{ color: 'var(--color-muted-fg)' }}
            onClick={() => setLogoUrl(null)}
          >
            Logoyu kaldır
          </button>
        )}
      </div>

      {/* Banner */}
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>Mağaza Banner'ı</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>
            Mağaza sayfanızın üst kısmındaki büyük alan.
          </p>
        </div>

        {/* Mod seçimi */}
        <div className="flex gap-3">
          {(['image', 'color'] as BannerMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBannerMode(mode)}
              className="flex-1 rounded-lg border py-2 text-sm font-medium transition-colors"
              style={{
                borderColor: bannerMode === mode ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: bannerMode === mode ? 'var(--color-accent-subtle, #f0f4ff)' : 'transparent',
                color: bannerMode === mode ? 'var(--color-accent)' : 'var(--color-muted-fg)',
              }}
            >
              {mode === 'image' ? 'Resim Yükle' : 'Renk ve Metin'}
            </button>
          ))}
        </div>

        {bannerMode === 'image' ? (
          <ImageUploader
            value={bannerUrl}
            onUpload={setBannerUrl}
            folder="stores"
            label="Banner görseli"
            aspectLabel="Geniş yatay görsel önerilir (örn. 1200×300 px)"
            disabled={loading}
          />
        ) : (
          <div className="space-y-4">
            {/* Arka plan rengi */}
            <div className="space-y-2">
              <Label>Arka plan rengi</Label>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="color"
                  value={bannerColor}
                  onChange={(e) => setBannerColor(e.target.value)}
                  disabled={loading}
                  className="h-9 w-16 cursor-pointer rounded border"
                  style={{ borderColor: 'var(--color-border)' }}
                />
                <span className="text-xs font-mono" style={{ color: 'var(--color-muted-fg)' }}>{bannerColor}</span>
                <div className="flex gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBannerColor(c)}
                      title={c}
                      className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        borderColor: bannerColor === c ? 'var(--color-primary)' : 'transparent',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Başlık metni */}
            <div className="space-y-1.5">
              <Label htmlFor="bannerHeadline">Başlık metni (isteğe bağlı)</Label>
              <Input
                id="bannerHeadline"
                value={bannerHeadline}
                onChange={(e) => setBannerHeadline(e.target.value)}
                maxLength={60}
                placeholder="Mağazanızın sloganı…"
                disabled={loading}
              />
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {bannerHeadline.length}/60
              </p>
            </div>

            {/* Metin rengi */}
            {bannerHeadline && (
              <div className="space-y-2">
                <Label>Metin rengi</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="color"
                    value={bannerTextColor}
                    onChange={(e) => setBannerTextColor(e.target.value)}
                    disabled={loading}
                    className="h-9 w-16 cursor-pointer rounded border"
                    style={{ borderColor: 'var(--color-border)' }}
                  />
                  <div className="flex gap-1.5">
                    {PRESET_TEXT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBannerTextColor(c)}
                        title={c}
                        className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: bannerTextColor === c ? 'var(--color-primary)' : 'var(--color-border)',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Yazı boyutu */}
            {bannerHeadline && (
              <div className="space-y-2">
                <Label>Yazı boyutu</Label>
                <div className="flex gap-2">
                  {FONT_SIZE_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFontSize(value)}
                      className="flex-1 rounded-lg border py-1.5 text-sm transition-colors"
                      style={{
                        borderColor: fontSize === value ? 'var(--color-accent)' : 'var(--color-border)',
                        backgroundColor: fontSize === value ? 'var(--color-accent-subtle, #f0f4ff)' : 'transparent',
                        color: fontSize === value ? 'var(--color-accent)' : 'var(--color-muted-fg)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Canlı önizleme */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>Önizleme</p>
              <div
                className="w-full rounded-xl overflow-hidden flex items-center justify-center"
                style={{
                  height: '80px',
                  backgroundColor: bannerColor,
                }}
              >
                {bannerHeadline && (
                  <p
                    className="text-center px-4 font-semibold"
                    style={{
                      color: bannerTextColor,
                      fontSize: fontSizePreview[fontSize],
                    }}
                  >
                    {bannerHeadline}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>
      )}
      {saved && (
        <p className="text-sm" style={{ color: 'var(--color-success)' }}>✓ Kaydedildi.</p>
      )}

      <Button type="button" onClick={handleSave} disabled={loading}>
        {loading ? 'Kaydediliyor…' : 'Mağaza Görsellerini Kaydet'}
      </Button>
    </div>
  )
}
