'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Textarea } from '@hanuja/ui'
import { FileUpload, type UploadedAsset } from '@hanuja/ui'

interface Props {
  productId: string
  initialName: string
  initialDescription: string
  initialPrice: number
  initialStock: number
  initialStatus: string
  existingImages?: UploadedAsset[]
}

export default function ProductEditForm({
  productId,
  initialName,
  initialDescription,
  initialPrice,
  initialStock,
  initialStatus,
  existingImages = [],
}: Props) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [price, setPrice] = useState(initialPrice)
  const [stock, setStock] = useState(initialStock)
  const [images, setImages] = useState<UploadedAsset[]>(existingImages)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSaved(false)

    try {
      // 1. Update product fields
      const res = await fetch(`/api/seller/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, price, stock }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Bir hata oluştu.')
        return
      }

      // 2. Attach any newly uploaded images (those not in initial set)
      const existingIds = new Set(existingImages.map((img) => img.id))
      const newImages = images.filter((img) => !existingIds.has(img.id))
      if (newImages.length > 0) {
        await fetch(`/api/seller/products/${productId}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaAssetIds: newImages.map((img) => img.id) }),
        })
      }

      setSaved(true)
      router.refresh()
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteImage(imageId: string) {
    try {
      await fetch(`/api/seller/products/${productId}/images?imageId=${imageId}`, {
        method: 'DELETE',
      })
      setImages((prev) => prev.filter((img) => img.id !== imageId))
    } catch {
      // Silently log — image still in DB but UI updated
      console.error('Görsel silinemedi')
    }
  }

  async function handleRemove() {
    if (!confirm('Bu ürünü kaldırmak istediğinizden emin misiniz?')) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/seller/products/${productId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Bir hata oluştu.')
        setLoading(false)
      } else {
        router.push('/urunler')
        router.refresh()
      }
    } catch {
      setError('Bağlantı hatası.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">Ürün Adı *</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={loading}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="price">Fiyat (₺) *</Label>
          <Input
            id="price"
            type="number"
            min={0}
            step={0.01}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stock">Stok *</Label>
          <Input
            id="stock"
            type="number"
            min={0}
            value={stock}
            onChange={(e) => setStock(Number(e.target.value))}
            required
            disabled={loading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Açıklama</Label>
        <Textarea
          id="description"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
        />
      </div>

      {/* Image upload */}
      <div className="space-y-2">
        <Label>Ürün Görselleri</Label>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          En fazla 8 görsel ekleyebilirsiniz. İlk görsel ana görsel olarak kullanılır.
        </p>
        <FileUpload
          folder="products"
          maxFiles={8}
          value={images}
          onChange={setImages}
          disabled={loading}
          showPreviews
        />
      </div>

      {/* Note: handleDeleteImage is available for future inline delete button */}
      {/* Currently deletes happen via the X button in FileUpload's existing assets */}

      {error && (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>
      )}
      {saved && (
        <p className="text-sm" style={{ color: 'var(--color-success)' }}>✓ Kaydedildi.</p>
      )}

      {initialStatus === 'rejected' && (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{
            borderColor: 'var(--color-destructive)',
            backgroundColor: 'color-mix(in srgb, var(--color-destructive) 8%, transparent)',
            color: 'var(--color-destructive)',
          }}
        >
          Bu ürün reddedildi. Düzenleyip tekrar gönderebilirsiniz.
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
        <Button
          variant="destructive"
          type="button"
          disabled={loading}
          onClick={handleRemove}
        >
          Ürünü Kaldır
        </Button>
      </div>
    </form>
  )
}
