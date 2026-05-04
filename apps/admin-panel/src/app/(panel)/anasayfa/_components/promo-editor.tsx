'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { ImagePlus } from 'lucide-react'
import { Button, Input, Label, Textarea } from '@hanuja/ui'
import { MediaPickerModal } from '../../medya/_components/media-picker-modal'
import { emptyToNull, readApiData, toDatetimeLocal } from './api'
import type { HomeMediaAsset, HomePromoItem, HomePromoSlot } from './types'

interface Props {
  slot: HomePromoSlot
  title: string
  promo: HomePromoItem | null
  onRefresh: () => Promise<void>
  onMessage: (message: string | null) => void
}

interface PromoFormState {
  title: string
  subtitle: string
  ctaHref: string
  startsAt: string
  endsAt: string
  isActive: boolean
}

const emptyForm: PromoFormState = {
  title: '',
  subtitle: '',
  ctaHref: '/',
  startsAt: '',
  endsAt: '',
  isActive: true,
}

function mediaLabel(asset: HomeMediaAsset | null) {
  if (!asset) return 'Görsel seçilmedi'
  return asset.originalName || asset.url.split('/').pop() || asset.id
}

export function PromoEditor({ slot, title, promo, onRefresh, onMessage }: Props) {
  const [form, setForm] = useState<PromoFormState>(emptyForm)
  const [mediaAsset, setMediaAsset] = useState<HomeMediaAsset | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!promo) {
      setForm(emptyForm)
      setMediaAsset(null)
      setError(null)
      return
    }

    setForm({
      title: promo.title,
      subtitle: promo.subtitle ?? '',
      ctaHref: promo.ctaHref,
      startsAt: toDatetimeLocal(promo.startsAt),
      endsAt: toDatetimeLocal(promo.endsAt),
      isActive: promo.isActive,
    })
    setMediaAsset(promo.mediaAsset)
    setError(null)
  }, [promo])

  const payload = useMemo(() => {
    return {
      mediaAssetId: mediaAsset?.id,
      title: form.title.trim(),
      subtitle: emptyToNull(form.subtitle),
      ctaHref: form.ctaHref.trim(),
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
      isActive: form.isActive,
    }
  }, [form, mediaAsset?.id])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!payload.mediaAssetId) {
      setError('Promo görseli seçin.')
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/admin/home-cms/promos/${slot}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await readApiData<{ promo: HomePromoItem }>(response)
      onMessage(`${title} kaydedildi.`)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promo kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4 rounded-lg border p-4"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
            {title}
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Ana sayfa sağ kolonundaki sabit promo alanı
          </p>
        </div>

        <div className="grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Label>Promo görseli</Label>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                Promo kartlarında yalnızca görsel kullanılabilir.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
              <ImagePlus className="h-4 w-4" />
              Medyadan Seç
            </Button>
          </div>
          <p className="truncate text-sm" style={{ color: 'var(--color-primary)' }}>
            {mediaLabel(mediaAsset)}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${slot}-title`}>Başlık</Label>
            <Input id={`${slot}-title`} required value={form.title} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${slot}-href`}>CTA URL</Label>
            <Input id={`${slot}-href`} required value={form.ctaHref} maxLength={500} onChange={(event) => setForm((current) => ({ ...current, ctaHref: event.target.value }))} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${slot}-subtitle`}>Alt metin</Label>
          <Textarea id={`${slot}-subtitle`} value={form.subtitle} maxLength={160} onChange={(event) => setForm((current) => ({ ...current, subtitle: event.target.value }))} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${slot}-starts-at`}>Başlangıç</Label>
            <Input id={`${slot}-starts-at`} type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${slot}-ends-at`}>Bitiş</Label>
            <Input id={`${slot}-ends-at`} type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} />
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-primary)' }}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
          />
          Aktif
        </label>

        {error && (
          <div className="rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#fef2f2', color: '#b91c1c' }}>
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Kaydet
          </Button>
        </div>
      </form>

      <aside className="space-y-3">
        <h3 className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Önizleme
        </h3>
        <div className="relative aspect-[5/3] overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
          {mediaAsset ? (
            <Image src={mediaAsset.url} alt="" fill sizes="360px" className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Görsel seçin
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-white">
            <p className="text-lg font-semibold">{form.title || title}</p>
            {form.subtitle && <p className="mt-1 line-clamp-2 text-sm text-white/85">{form.subtitle}</p>}
          </div>
        </div>
      </aside>

      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        acceptKind="image"
        folder="promo"
        onSelect={setMediaAsset}
      />
    </div>
  )
}
