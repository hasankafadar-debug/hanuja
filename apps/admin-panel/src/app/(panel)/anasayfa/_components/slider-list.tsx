'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { readApiData } from './api'
import { SlideEditor } from './slide-editor'
import type { HomeSellerOption, HomeSlideItem } from './types'

interface Props {
  slides: HomeSlideItem[]
  sellers: HomeSellerOption[]
  onSlidesChange: (slides: HomeSlideItem[]) => void
  onRefresh: () => Promise<void>
  onMessage: (message: string | null) => void
}

function moveItem(items: HomeSlideItem[], fromIndex: number, toIndex: number) {
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  if (!item) return items
  next.splice(toIndex, 0, item)
  return next.map((slide, index) => ({ ...slide, sortOrder: index }))
}

function getWindowLabel(slide: HomeSlideItem) {
  const now = Date.now()
  const starts = slide.startsAt ? new Date(slide.startsAt).getTime() : null
  const ends = slide.endsAt ? new Date(slide.endsAt).getTime() : null

  if (!slide.isActive) return { label: 'Pasif', variant: 'secondary' as const }
  if (starts && starts > now) return { label: 'Zamanlı', variant: 'outline' as const }
  if (ends && ends < now) return { label: 'Süresi doldu', variant: 'destructive' as const }
  return { label: 'Yayında', variant: 'default' as const }
}

export function SliderList({ slides, sellers, onSlidesChange, onRefresh, onMessage }: Props) {
  const [editingSlide, setEditingSlide] = useState<HomeSlideItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const persistOrder = async (nextSlides: HomeSlideItem[]) => {
    onSlidesChange(nextSlides)
    const response = await fetch('/api/admin/home-cms/slides/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: nextSlides.map((slide) => slide.id) }),
    })
    await readApiData<{ ids: string[] }>(response)
    onMessage('Slayt sırası güncellendi.')
    await onRefresh()
  }

  const handleMove = async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= slides.length || fromIndex === toIndex) return
    try {
      await persistOrder(moveItem(slides, fromIndex, toIndex))
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Sıralama güncellenemedi.')
      await onRefresh()
    }
  }

  const handleDrop = async (targetId: string) => {
    if (!draggedId || draggedId === targetId) return
    const fromIndex = slides.findIndex((slide) => slide.id === draggedId)
    const toIndex = slides.findIndex((slide) => slide.id === targetId)
    setDraggedId(null)
    if (fromIndex < 0 || toIndex < 0) return
    await handleMove(fromIndex, toIndex)
  }

  const handleToggle = async (slide: HomeSlideItem) => {
    setBusyId(slide.id)
    try {
      const response = await fetch(`/api/admin/home-cms/slides/${slide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !slide.isActive }),
      })
      await readApiData<{ slide: HomeSlideItem }>(response)
      onMessage(slide.isActive ? 'Slayt pasife alındı.' : 'Slayt yayına alındı.')
      await onRefresh()
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Slayt güncellenemedi.')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (slide: HomeSlideItem) => {
    if (!confirm(`"${slide.title}" slaytı silinsin mi?`)) return
    setBusyId(slide.id)
    try {
      const response = await fetch(`/api/admin/home-cms/slides/${slide.id}`, { method: 'DELETE' })
      if (!response.ok) await readApiData<never>(response)
      onMessage('Slayt silindi.')
      await onRefresh()
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Slayt silinemedi.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
            Hero slaytları
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {slides.length} slayt; sürükleyip bırakarak veya oklarla sıralayın.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Yeni Slayt
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
        {slides.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Henüz slayt yok. İlk slaytı ekleyerek başlayın.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {slides.map((slide, index) => {
              const status = getWindowLabel(slide)
              const mediaUrl = normalizeMediaDisplayUrl(slide.mediaAsset.url)
              const posterUrl = slide.posterAsset?.url
                ? normalizeMediaDisplayUrl(slide.posterAsset.url)
                : undefined
              const useUnoptimizedImage = mediaUrl.startsWith('/api/media/fetch?')
              return (
                <div
                  key={slide.id}
                  draggable
                  onDragStart={() => setDraggedId(slide.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    void handleDrop(slide.id)
                  }}
                  className="grid gap-3 p-4 transition-colors md:grid-cols-[auto_120px_1fr_auto]"
                  style={{ backgroundColor: draggedId === slide.id ? 'var(--color-muted)' : 'var(--color-surface)' }}
                >
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
                    <span className="w-6 text-sm tabular-nums" style={{ color: 'var(--color-muted-fg)' }}>
                      {index + 1}
                    </span>
                  </div>

                  <div className="relative h-20 overflow-hidden rounded-md border" style={{ borderColor: 'var(--color-border)' }}>
                    {slide.mediaAsset.kind === 'video' ? (
                      <video src={mediaUrl} poster={posterUrl} className="h-full w-full object-cover" muted />
                    ) : (
                      <Image src={mediaUrl} alt="" fill sizes="120px" className="object-cover" unoptimized={useUnoptimizedImage} />
                    )}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-medium" style={{ color: 'var(--color-primary)' }}>
                        {slide.title}
                      </h3>
                      <Badge variant={status.variant}>{status.label}</Badge>
                      <Badge variant="outline">{slide.mediaAsset.kind === 'video' ? 'Video' : 'Görsel'}</Badge>
                    </div>
                    <p className="line-clamp-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                      {slide.eyebrow ? `${slide.eyebrow} · ` : ''}
                      {slide.ctaLabel} → {slide.ctaHref}
                    </p>
                    {slide.seller && (
                      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        Satıcı: {slide.seller.displayName}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <Button variant="outline" size="sm" onClick={() => void handleMove(index, index - 1)} disabled={index === 0 || busyId === slide.id}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleMove(index, index + 1)} disabled={index === slides.length - 1 || busyId === slide.id}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleToggle(slide)} loading={busyId === slide.id}>
                      {slide.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingSlide(slide)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => void handleDelete(slide)} loading={busyId === slide.id}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <SlideEditor
        open={creating || editingSlide !== null}
        slide={editingSlide}
        sellers={sellers}
        nextSortOrder={slides.length}
        onClose={() => {
          setCreating(false)
          setEditingSlide(null)
        }}
        onSaved={async () => {
          setCreating(false)
          setEditingSlide(null)
          onMessage('Slayt kaydedildi.')
          await onRefresh()
        }}
      />
    </div>
  )
}
