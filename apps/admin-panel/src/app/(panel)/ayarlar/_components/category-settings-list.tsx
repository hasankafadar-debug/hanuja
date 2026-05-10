'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@hanuja/ui'

interface CategoryTaxGroupRow {
  key: string
  name: string
  categoryIds: string[]
  memberPaths: string[]
  memberCount: number
  taxRate: string | null
  hasMixedRates: boolean
}

interface Props {
  categories: CategoryTaxGroupRow[]
}

interface CategoryGroupDraft {
  key: string
  name: string
  categoryIds: string[]
  memberPaths: string[]
  taxRate: string
  hasMixedRates: boolean
}

function toDraft(group: CategoryTaxGroupRow): CategoryGroupDraft {
  return {
    key: group.key,
    name: group.name,
    categoryIds: group.categoryIds,
    memberPaths: group.memberPaths,
    taxRate: group.taxRate === null ? '' : String(Number(group.taxRate) * 100),
    hasMixedRates: group.hasMixedRates,
  }
}

function formatRateLabel(group: CategoryTaxGroupRow) {
  if (group.hasMixedRates) return 'Karma'
  if (group.taxRate === null) return 'Varsayılan'
  return `%${Number(group.taxRate) * 100}`
}

export function CategorySettingsList({ categories }: Props) {
  const router = useRouter()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<CategoryGroupDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.key, category])),
    [categories],
  )

  function openEditor(groupKey: string) {
    const category = categoryMap.get(groupKey)
    if (!category) return
    setEditingKey(groupKey)
    setDraft(toDraft(category))
    setError(null)
  }

  async function saveCategoryGroup() {
    if (!editingKey || !draft) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/categories/tax-groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryIds: draft.categoryIds,
          taxRate: draft.taxRate.trim() ? Number(draft.taxRate) / 100 : null,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(payload.message ?? payload.error ?? 'Kategori KDV oranı güncellenemedi.')
        return
      }

      setEditingKey(null)
      setDraft(null)
      router.refresh()
    } catch {
      setError('Bağlantı sırasında bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {categories.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Henüz KDV grubu tanımlanmamış.
        </p>
      )}

      <div className="space-y-1">
        {categories.map((category) => (
          <div
            key={category.key}
            className="flex items-center justify-between gap-4 border-b py-3 text-sm last:border-0"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--color-primary)' }}>{category.name}</span>
                <Badge variant="secondary">{category.memberCount} kategori</Badge>
              </div>
              <div
                className="mt-1 flex flex-wrap items-center gap-3 text-xs"
                style={{ color: 'var(--color-muted-fg)' }}
              >
                <span>KDV: {formatRateLabel(category)}</span>
                <span>{category.memberPaths.join(' • ')}</span>
              </div>
            </div>

            <Button size="sm" variant="outline" onClick={() => openEditor(category.key)}>
              Düzenle
            </Button>
          </div>
        ))}
      </div>

      <Dialog
        open={editingKey !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingKey(null)
            setDraft(null)
            setError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>KDV Grubunu Düzenle</DialogTitle>
            <DialogDescription>
              Kaydettiğiniz oran bu gruptaki tüm ana kategorilere birlikte uygulanır.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Grup</Label>
                <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                  <p style={{ color: 'var(--color-primary)' }}>{draft.name}</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {draft.memberPaths.join(' • ')}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category-tax-rate">KDV Oranı (%)</Label>
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
                  placeholder="Boşsa üst kategori veya platform varsayılanı"
                />
                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {draft.hasMixedRates
                    ? 'Bu grup şu anda Karma görünüyor. Yeni oran kaydedildiğinde tüm üyeler aynı değere çekilir.'
                    : 'Boş bırakırsanız üst kategori veya platform varsayılanı kullanılır.'}
                </p>
              </div>

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
                setEditingKey(null)
                setDraft(null)
                setError(null)
              }}
              disabled={loading}
            >
              Vazgeç
            </Button>
            <Button onClick={saveCategoryGroup} disabled={loading || !draft}>
              {loading ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
