'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Input,
  Label,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@hanuja/ui'
import { FileUpload, type UploadedAsset } from '@hanuja/ui'

interface Category {
  id: string
  name: string
}

interface Props {
  categories: Category[]
}

export default function NewProductForm({ categories }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<UploadedAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // 1. Create the product
      const res = await fetch('/api/seller/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          categoryId,
          price: parseFloat(price),
          stockQuantity: parseInt(stock, 10),
          description,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Bir hata oluştu.')
        return
      }

      const productId = data.productId as string

      // 2. Attach uploaded images (if any) — fire-and-forget on failure
      if (images.length > 0) {
        await fetch(`/api/seller/products/${productId}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaAssetIds: images.map((img) => img.id) }),
        }).catch((err) => console.error('Görsel attach başarısız:', err))
      }

      // Ürün oluşturuldu — ürün listesine yönlendir
      router.push('/urunler')
      router.refresh()
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">Ürün Adı *</Label>
        <Input
          id="name"
          placeholder="Masif Meşe Orta Sehpa"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={loading}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="category">Kategori *</Label>
        <Select onValueChange={setCategoryId} value={categoryId}>
          <SelectTrigger disabled={loading}>
            <SelectValue placeholder="Kategori seçin" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="price">Fiyat (₺) *</Label>
          <Input
            id="price"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stock">Stok Adedi *</Label>
          <Input
            id="stock"
            type="number"
            min="0"
            placeholder="0"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            required
            disabled={loading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Ürün Açıklaması</Label>
        <Textarea
          id="description"
          rows={5}
          placeholder="Ürününüzü detaylı bir şekilde açıklayın..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
        />
      </div>

      {/* Image upload */}
      <div className="space-y-2">
        <Label>Ürün Görselleri</Label>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          İsteğe bağlı. En fazla 8 görsel yükleyebilirsiniz. İlk görsel ana görsel olur.
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

      {error && (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>
      )}

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <p style={{ color: 'var(--color-muted-fg)' }}>
          Ürününüz admin incelemesinden sonra yayınlanacaktır (<strong>pending_review</strong> durumu).
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={loading || !categoryId}>
          {loading ? 'Kaydediliyor…' : 'Ürünü Gönder'}
        </Button>
      </div>
    </form>
  )
}
