'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@hanuja/ui'

interface CategoryRow {
  id: string
  name: string
  slug: string
  description: string | null
  imageUrl: string | null
  sortOrder: number
  isActive: boolean
  taxRate: { toString(): string } | string | number | null
}

interface Props {
  categories: CategoryRow[]
}

interface CategoryDraft {
  id: string
  name: string
  slug: string
  description: string
  imageUrl: string
  sortOrder: string
  isActive: boolean
  taxRate: string
}

function toDraft(category: CategoryRow): CategoryDraft {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description ?? '',
    imageUrl: category.imageUrl ?? '',
    sortOrder: String(category.sortOrder),
    isActive: category.isActive,
    taxRate: category.taxRate === null ? '' : String(Number(category.taxRate) * 100),
  }
}

export function CategorySettingsList({ categories }: Props) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CategoryDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )

  function openEditor(categoryId: string) {
    const category = categoryMap.get(categoryId)
    if (!category) return
    setEditingId(categoryId)
    setDraft(toDraft(category))
    setError(null)
  }

  async function saveCategory() {
    if (!editingId || !draft) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/admin/categories/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          slug: draft.slug,
          description: draft.description || null,
          imageUrl: draft.imageUrl || null,
          sortOrder: Number(draft.sortOrder || '0'),
          isActive: draft.isActive,
          taxRate: draft.taxRate.trim() ? Number(draft.taxRate) / 100 : null,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(payload.error ?? 'Kategori guncellenemedi.')
        return
      }

      setEditingId(null)
      setDraft(null)
      router.refresh()
    } catch {
      setError('Baglanti sirasinda bir hata olustu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {categories.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Henuz kategori tanimlanmamis.
        </p>
      )}

      <div className="space-y-1">
        {categories.map((category) => (
          <div
            key={category.id}
            className="flex items-center justify-between gap-4 border-b py-3 text-sm last:border-0"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--color-primary)' }}>{category.name}</span>
                <Badge variant={category.isActive ? 'secondary' : 'outline'}>
                  {category.isActive ? 'Aktif' : 'Pasif'}
                </Badge>
              </div>
              <div
                className="mt-1 flex flex-wrap items-center gap-3 text-xs"
                style={{ color: 'var(--color-muted-fg)' }}
              >
                <span className="font-mono">/kategori/{category.slug}</span>
                <span>Sira: {category.sortOrder}</span>
                <span>KDV: {category.taxRate === null ? 'Varsayilan' : `%${Number(category.taxRate) * 100}`}</span>
              </div>
            </div>

            <Button size="sm" variant="outline" onClick={() => openEditor(category.id)}>
              Duzenle
            </Button>
          </div>
        ))}
      </div>

      <Dialog
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingId(null)
            setDraft(null)
            setError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kategori Duzenle</DialogTitle>
            <DialogDescription>
              Kategori adi, slug ve yayin durumu guncellendiginde ilgili urunler arama indeksine yeniden yazilir.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="category-name">Kategori Adi</Label>
                <Input
                  id="category-name"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category-slug">Slug</Label>
                <Input
                  id="category-slug"
                  value={draft.slug}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, slug: event.target.value } : current))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category-sort-order">Sira</Label>
                <Input
                  id="category-sort-order"
                  type="number"
                  min={0}
                  value={draft.sortOrder}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, sortOrder: event.target.value } : current))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category-tax-rate">KDV Orani (%)</Label>
                <Input
                  id="category-tax-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={draft.taxRate}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, taxRate: event.target.value } : current))
                  }
                  placeholder="Bossa platform varsayilani"
                />
                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  Bos birakirsaniz ust kategoriden veya platform varsayilanindan hesaplanir.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category-image-url">Gorsel URL</Label>
                <Input
                  id="category-image-url"
                  value={draft.imageUrl}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, imageUrl: event.target.value } : current))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category-description">Aciklama</Label>
                <Textarea
                  id="category-description"
                  rows={4}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, description: event.target.value } : current))
                  }
                />
              </div>

              <label className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-primary)' }}>
                <Checkbox
                  checked={draft.isActive}
                  onCheckedChange={(checked) =>
                    setDraft((current) => (current ? { ...current, isActive: checked === true } : current))
                  }
                />
                Kategori aktif
              </label>

              {error && (
                <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                  {error}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditingId(null)
                setDraft(null)
                setError(null)
              }}
              disabled={loading}
            >
              Vazgec
            </Button>
            <Button onClick={saveCategory} disabled={loading || !draft}>
              {loading ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
