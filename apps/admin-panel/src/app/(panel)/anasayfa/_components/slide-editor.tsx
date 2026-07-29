'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { ImagePlus, X } from 'lucide-react'
import { Button, Input, Label, Textarea, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { MediaPickerModal } from '../../medya/_components/media-picker-modal'
import { emptyToNull, readApiData, toDatetimeLocal } from './api'
import type { HomeMediaAsset, HomeSellerOption, HomeSlideItem } from './types'

interface Props {
  open: boolean
  slide: HomeSlideItem | null
  sellers: HomeSellerOption[]
  nextSortOrder: number
  onClose: () => void
  onSaved: () => Promise<void>
}

interface SlideFormState {
  eyebrow: string
  title: string
  body: string
  ctaLabel: string
  ctaHref: string
  startsAt: string
  endsAt: string
  sellerId: string
  isActive: boolean
}

const emptyForm: SlideFormState = {
  eyebrow: '',
  title: '',
  body: '',
  ctaLabel: 'Keşfet',
  ctaHref: '/',
  startsAt: '',
  endsAt: '',
  sellerId: '',
  isActive: true,
}

function mediaLabel(asset: HomeMediaAsset | null) {
  if (!asset) return 'Medya seçilmedi'
  return asset.originalName || asset.url.split('/').pop() || asset.id
}

export function SlideEditor({ open, slide, sellers, nextSortOrder, onClose, onSaved }: Props) {
  const [form, setForm] = useState<SlideFormState>(emptyForm)
  const [mediaAsset, setMediaAsset] = useState<HomeMediaAsset | null>(null)
  const [posterAsset, setPosterAsset] = useState<HomeMediaAsset | null>(null)
  const [picker, setPicker] = useState<'media' | 'poster' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (!slide) {
      setForm(emptyForm)
      setMediaAsset(null)
      setPosterAsset(null)
      setError(null)
      return
    }

    setForm({
      eyebrow: slide.eyebrow ?? '',
      title: slide.title,
      body: slide.body ?? '',
      ctaLabel: slide.ctaLabel,
      ctaHref: slide.ctaHref,
      startsAt: toDatetimeLocal(slide.startsAt),
      endsAt: toDatetimeLocal(slide.endsAt),
      sellerId: slide.sellerId ?? '',
      isActive: slide.isActive,
    })
    setMediaAsset(slide.mediaAsset)
    setPosterAsset(slide.posterAsset)
    setError(null)
  }, [open, slide])

  const isVideo = mediaAsset?.kind === 'video'
  const previewTitle = form.title.trim() || 'Slayt başlığı'
  const normalizedMediaUrl = mediaAsset ? normalizeMediaDisplayUrl(mediaAsset.url) : null
  const normalizedPosterUrl = posterAsset ? normalizeMediaDisplayUrl(posterAsset.url) : undefined
  const useUnoptimizedPreview = Boolean(normalizedMediaUrl?.startsWith('/api/media/fetch?'))

  const payload = useMemo(() => {
    return {
      mediaAssetId: mediaAsset?.id,
      posterAssetId: isVideo ? posterAsset?.id ?? null : null,
      eyebrow: emptyToNull(form.eyebrow),
      title: form.title.trim(),
      body: emptyToNull(form.body),
      ctaLabel: form.ctaLabel.trim(),
      ctaHref: form.ctaHref.trim(),
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
      sellerId: form.sellerId || null,
      isActive: form.isActive,
      ...(!slide ? { sortOrder: nextSortOrder } : {}),
    }
  }, [form, isVideo, mediaAsset?.id, nextSortOrder, posterAsset?.id, slide])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!payload.mediaAssetId) {
      setError('Slayt medyası seçin.')
      return
    }
    if (isVideo && !payload.posterAssetId) {
      setError('Video slaytları için poster görseli zorunludur.')
      return
    }

    setSaving(true)
    try {
      const response = await fetch(
        slide ? `/api/admin/home-cms/slides/${slide.id}` : '/api/admin/home-cms/slides',
        {
          method: slide ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      await readApiData<{ slide: HomeSlideItem }>(response)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slayt kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/50 p-4">
      <div
        className="mx-auto my-8 w-full max-w-5xl rounded-lg border p-5 shadow-xl"
        style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-border)' }}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
              {slide ? 'Slaytı düzenle' : 'Yeni slayt'}
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Hero slider içinde görünecek içerik ve yayın penceresi
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Label>Slayt medyası</Label>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    Görsel veya slider videosu seçin.
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={() => setPicker('media')}>
                  <ImagePlus className="h-4 w-4" />
                  Medyadan Seç
                </Button>
              </div>
              <p className="truncate text-sm" style={{ color: 'var(--color-primary)' }}>
                {mediaLabel(mediaAsset)}
              </p>
            </div>

            {isVideo && (
              <div className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Label>Video poster görseli</Label>
                    <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      Video yüklenmeden önce ve düşük bağlantıda gösterilir.
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => setPicker('poster')}>
                    <ImagePlus className="h-4 w-4" />
                    Poster Seç
                  </Button>
                </div>
                <p className="truncate text-sm" style={{ color: 'var(--color-primary)' }}>
                  {mediaLabel(posterAsset)}
                </p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="slide-eyebrow">Eyebrow</Label>
                <Input id="slide-eyebrow" value={form.eyebrow} maxLength={60} onChange={(event) => setForm((current) => ({ ...current, eyebrow: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slide-title">Başlık</Label>
                <Input id="slide-title" required value={form.title} maxLength={120} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="slide-body">Açıklama</Label>
              <Textarea id="slide-body" value={form.body} maxLength={300} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="slide-cta-label">CTA etiketi</Label>
                <Input id="slide-cta-label" required value={form.ctaLabel} maxLength={40} onChange={(event) => setForm((current) => ({ ...current, ctaLabel: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slide-cta-href">CTA URL</Label>
                <Input id="slide-cta-href" required value={form.ctaHref} maxLength={500} onChange={(event) => setForm((current) => ({ ...current, ctaHref: event.target.value }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="slide-starts-at">Başlangıç</Label>
                <Input id="slide-starts-at" type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slide-ends-at">Bitiş</Label>
                <Input id="slide-ends-at" type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="slide-seller">Atfedilen satıcı</Label>
                <select
                  id="slide-seller"
                  value={form.sellerId}
                  onChange={(event) => setForm((current) => ({ ...current, sellerId: event.target.value }))}
                  className="h-10 w-full rounded-md border px-3 text-sm"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-primary)' }}
                >
                  <option value="">Satıcı yok</option>
                  {sellers.map((seller) => (
                    <option key={seller.id} value={seller.id}>
                      {seller.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-3 pt-7 text-sm" style={{ color: 'var(--color-primary)' }}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                />
                Aktif
              </label>
            </div>

            {error && (
              <div className="rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Vazgeç
              </Button>
              <Button type="submit" loading={saving}>
                Kaydet
              </Button>
            </div>
          </div>

          <aside className="space-y-3">
            <h3 className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              Önizleme
            </h3>
            <div className="relative aspect-[16/9] overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
              {mediaAsset ? (
                mediaAsset.kind === 'video' ? (
                  <video src={normalizedMediaUrl ?? mediaAsset.url} poster={normalizedPosterUrl} className="h-full w-full object-cover" muted controls />
                ) : (
                  <Image
                    src={normalizedMediaUrl ?? mediaAsset.url}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 420px, 100vw"
                    className="object-cover"
                    unoptimized={useUnoptimizedPreview}
                  />
                )
              ) : (
                <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  Medya seçin
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-5 text-white">
                {form.eyebrow && <p className="text-xs font-semibold uppercase">{form.eyebrow}</p>}
                <p className="mt-1 text-xl font-semibold">{previewTitle}</p>
                {form.body && <p className="mt-1 line-clamp-2 text-sm text-white/85">{form.body}</p>}
                <p className="mt-3 text-sm font-medium">{form.ctaLabel || 'Keşfet'}</p>
              </div>
            </div>
          </aside>
        </form>
      </div>

      <MediaPickerModal
        open={picker !== null}
        onClose={() => setPicker(null)}
        acceptKind={picker === 'poster' ? 'image' : 'all'}
        folder="slider"
        allowSellerProducts
        onSelect={(asset) => {
          if (picker === 'poster') {
            setPosterAsset(asset)
          } else {
            setMediaAsset(asset)
            if (asset.kind !== 'video') setPosterAsset(null)
          }
        }}
      />
    </div>
  )
}
