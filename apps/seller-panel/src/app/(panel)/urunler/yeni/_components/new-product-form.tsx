'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@hanuja/ui'
import { FileUpload, type UploadedAsset } from '@hanuja/ui'
import { Plus, Trash2 } from 'lucide-react'

interface Category {
  id: string
  name: string
}

interface Props {
  categories: Category[]
}

interface VariantFormRow {
  localId: string
  color: string
  size: string
  customOptionName: string
  customOptionValue: string
  barcode: string
  price: string
  stockQuantity: string
}

function createVariantRow(): VariantFormRow {
  return {
    localId: crypto.randomUUID(),
    color: '',
    size: '',
    customOptionName: '',
    customOptionValue: '',
    barcode: '',
    price: '',
    stockQuantity: '',
  }
}

export default function NewProductForm({ categories }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [compareAtPrice, setCompareAtPrice] = useState('')
  const [stock, setStock] = useState('')
  const [barcode, setBarcode] = useState('')
  const [sku, setSku] = useState('')
  const [shortDescription, setShortDescription] = useState('')
  const [description, setDescription] = useState('')
  const [story, setStory] = useState('')
  const [careInstructions, setCareInstructions] = useState('')
  const [images, setImages] = useState<UploadedAsset[]>([])
  const [variants, setVariants] = useState<VariantFormRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasVariants = variants.length > 0
  const variantsValid = variants.every(
    (variant) =>
      variant.barcode.trim().length === 13 &&
      Number(variant.price) > 0 &&
      Number.isInteger(Number(variant.stockQuantity)) &&
      Number(variant.stockQuantity) >= 0,
  )
  const submitDisabled =
    loading || !categoryId || (!hasVariants && barcode.trim().length !== 13) || (hasVariants && !variantsValid)
  const missingSubmitReason = !categoryId
    ? 'Urunu gondermek icin kategori secin.'
    : hasVariants && !variantsValid
      ? 'Varyasyonlu urunlerde her satir icin 13 haneli barkod, fiyat ve stok girin.'
      : !hasVariants && barcode.trim().length !== 13
        ? 'Urunu gondermek icin 13 haneli barkod girin.'
        : null

  function updateVariant(localId: string, patch: Partial<VariantFormRow>) {
    setVariants((current) =>
      current.map((variant) => (variant.localId === localId ? { ...variant, ...patch } : variant)),
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/seller/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          categoryId,
          price: parseFloat(price),
          compareAtPrice: compareAtPrice ? parseFloat(compareAtPrice) : undefined,
          stockQuantity: parseInt(stock || '0', 10),
          barcode: hasVariants ? null : barcode.trim(),
          sku: sku.trim() || undefined,
          shortDescription,
          description,
          story,
          careInstructions,
          variants: variants.map((variant) => ({
            color: variant.color.trim() || undefined,
            size: variant.size.trim() || undefined,
            customOptionName: variant.customOptionName.trim() || undefined,
            customOptionValue: variant.customOptionValue.trim() || undefined,
            barcode: variant.barcode.trim(),
            price: Number(variant.price),
            stockQuantity: Number(variant.stockQuantity),
          })),
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Bir hata olustu.')
        return
      }

      const productId = data.productId as string

      if (images.length > 0) {
        await fetch(`/api/seller/products/${productId}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaAssetIds: images.map((img) => img.id) }),
        }).catch((err) => console.error('Gorsel attach basarisiz:', err))
      }

      router.push('/urunler')
      router.refresh()
    } catch {
      setError('Baglanti hatasi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">Urun Adi *</Label>
        <Input id="name" placeholder="Masif Mese Orta Sehpa" value={name} onChange={(e) => setName(e.target.value)} required disabled={loading} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="category">Kategori *</Label>
        <Select onValueChange={setCategoryId} value={categoryId}>
          <SelectTrigger id="category" aria-label="Kategori" disabled={loading}>
            <SelectValue placeholder="Kategori secin" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="price">Fiyat (TL) *</Label>
          <Input id="price" type="number" min="0" step="0.01" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} required disabled={loading} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="compareAtPrice">Liste Fiyati (ustu cizili)</Label>
          <Input id="compareAtPrice" type="number" min="0" step="0.01" placeholder="Istege bagli" value={compareAtPrice} onChange={(e) => setCompareAtPrice(e.target.value)} disabled={loading} />
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Indirim gostermek isterseniz liste fiyatini satis fiyatindan yuksek girin.
      </p>

      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="stock">Stok Adedi *</Label>
        <Input id="stock" type="number" min="0" placeholder="0" value={stock} onChange={(e) => setStock(e.target.value)} required disabled={loading || hasVariants} />
        {hasVariants ? (
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Varyasyonlu urunde stok varyasyon satirlarindan hesaplanir.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="barcode">Barkod (13 hane) *</Label>
          <Input
            id="barcode"
            inputMode="numeric"
            pattern="\d{13}"
            placeholder="8691234567890"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value.replace(/\D/g, '').slice(0, 13))}
            required={!hasVariants}
            disabled={loading || hasVariants}
          />
          {hasVariants ? (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Varyasyonlu urunde barkod varyasyon satirlarindan okunur.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" placeholder="SEHPA-001" value={sku} onChange={(e) => setSku(e.target.value)} disabled={loading} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Varyasyonlar</Label>
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Renk, beden veya ek ozellik varsa her varyasyonu ayri barkodla girin.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => setVariants((current) => [...current, createVariantRow()])} disabled={loading}>
            <Plus className="h-4 w-4" /> Varyasyon Ekle
          </Button>
        </div>

        {variants.map((variant, index) => (
          <div key={variant.localId} className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">Varyasyon {index + 1}</span>
              <Button type="button" variant="ghost" size="sm" aria-label="Varyasyonu sil" onClick={() => setVariants((current) => current.filter((item) => item.localId !== variant.localId))} disabled={loading}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input placeholder="Renk" value={variant.color} onChange={(e) => updateVariant(variant.localId, { color: e.target.value })} disabled={loading} />
              <Input placeholder="Beden" value={variant.size} onChange={(e) => updateVariant(variant.localId, { size: e.target.value })} disabled={loading} />
              <Input placeholder="Ek Ozellik Adi" value={variant.customOptionName} onChange={(e) => updateVariant(variant.localId, { customOptionName: e.target.value })} disabled={loading} />
              <Input placeholder="Ek Ozellik Degeri" value={variant.customOptionValue} onChange={(e) => updateVariant(variant.localId, { customOptionValue: e.target.value })} disabled={loading} />
              <Input inputMode="numeric" pattern="\d{13}" placeholder="Barkod (13 hane)" value={variant.barcode} onChange={(e) => updateVariant(variant.localId, { barcode: e.target.value.replace(/\D/g, '').slice(0, 13) })} required disabled={loading} />
              <Input type="number" min="0" step="0.01" placeholder="Fiyat" value={variant.price} onChange={(e) => updateVariant(variant.localId, { price: e.target.value })} required disabled={loading} />
              <Input type="number" min="0" step="1" placeholder="Stok" value={variant.stockQuantity} onChange={(e) => updateVariant(variant.localId, { stockQuantity: e.target.value })} required disabled={loading} />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="shortDescription">Kisa Aciklama</Label>
        <Textarea id="shortDescription" rows={3} value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} disabled={loading} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Urun Aciklamasi</Label>
        <Textarea id="description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} disabled={loading} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="story">Urun Hikayesi</Label>
        <Textarea id="story" rows={4} value={story} onChange={(e) => setStory(e.target.value)} disabled={loading} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="careInstructions">Bakim Tavsiyesi</Label>
        <Textarea id="careInstructions" rows={4} value={careInstructions} onChange={(e) => setCareInstructions(e.target.value)} disabled={loading} />
      </div>

      <div className="space-y-2">
        <Label>Urun Gorselleri</Label>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          En fazla 8 gorsel yukleyebilirsiniz. Ilk gorsel ana gorsel olur.
        </p>
        <FileUpload
          folder="products"
          maxFiles={8}
          value={images}
          onChange={setImages}
          disabled={loading}
          showPreviews
          imageConstraints={{
            exactWidth: 1200,
            exactHeight: 1200,
            minDpi: 72,
            maxDpi: 100,
            allowedTypes: ['image/jpeg', 'image/png'],
          }}
          inputLabel="Urun gorseli yukle"
        />
      </div>

      {error && <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>}

      <div className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
        <p style={{ color: 'var(--color-muted-fg)' }}>
          Urununuz admin incelemesinden sonra yayinlanacaktir.
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={submitDisabled} aria-describedby={missingSubmitReason ? 'product-submit-hint' : undefined}>
          {loading ? 'Kaydediliyor...' : 'Urunu Gonder'}
        </Button>
      </div>
      {missingSubmitReason ? (
        <p id="product-submit-hint" className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          {missingSubmitReason}
        </p>
      ) : null}
    </form>
  )
}
