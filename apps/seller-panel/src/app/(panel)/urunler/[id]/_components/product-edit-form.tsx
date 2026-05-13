'use client'

import { useState, useEffect } from 'react'
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
  normalizeMediaDisplayUrl,
} from '@hanuja/ui'
import { FileUpload, type UploadedAsset } from '@hanuja/ui'
import { Plus, Star, Trash2 } from 'lucide-react'

interface Category {
  id: string
  name: string
}

interface AttributeOption {
  id: string
  slug: string
  label: string
  hexColor: string | null
}

interface VariantFormRow {
  localId: string
  dbId?: string // DB'deki gerçek ID — mevcut varyantlarda dolu, yenilerde boş
  color: string
  size: string
  customOptionName: string
  customOptionValue: string
  barcode: string
  price: string
  stockQuantity: string
}

interface ExistingImage extends UploadedAsset {
  isPrimary?: boolean
}

interface Props {
  productId: string
  initialName: string
  initialDescription: string
  initialShortDescription?: string
  initialStory?: string
  initialCareInstructions?: string
  initialCategoryId?: string
  initialPrice: number
  initialCompareAtPrice?: number | null
  initialStock: number
  initialSku?: string
  initialBarcode?: string
  initialStatus: string
  initialVariants?: VariantFormRow[]
  existingImages?: ExistingImage[]
  categories: Category[]
  initialColorOptionId?: string
  initialMaterialOptionId?: string
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

export default function ProductEditForm({
  productId,
  initialName,
  initialDescription,
  initialShortDescription = '',
  initialStory = '',
  initialCareInstructions = '',
  initialCategoryId = '',
  initialPrice,
  initialCompareAtPrice = null,
  initialStock,
  initialSku = '',
  initialBarcode = '',
  initialStatus,
  initialVariants = [],
  existingImages = [],
  categories,
  initialColorOptionId = '',
  initialMaterialOptionId = '',
}: Props) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [shortDescription, setShortDescription] = useState(initialShortDescription)
  const [story, setStory] = useState(initialStory)
  const [careInstructions, setCareInstructions] = useState(initialCareInstructions)
  const [categoryId, setCategoryId] = useState(initialCategoryId)
  const [colorOptionId, setColorOptionId] = useState(initialColorOptionId)
  const [materialOptionId, setMaterialOptionId] = useState(initialMaterialOptionId)
  const [colorOptions, setColorOptions] = useState<AttributeOption[]>([])
  const [materialOptions, setMaterialOptions] = useState<AttributeOption[]>([])
  const [price, setPrice] = useState(initialPrice)
  const [compareAtPrice, setCompareAtPrice] = useState(
    initialCompareAtPrice !== null && initialCompareAtPrice !== undefined ? String(initialCompareAtPrice) : '',
  )
  const [stock, setStock] = useState(initialStock)
  const [sku, setSku] = useState(initialSku)
  const [barcode, setBarcode] = useState(initialBarcode)
  const [images, setImages] = useState<UploadedAsset[]>(existingImages)
  const [primaryImageId, setPrimaryImageId] = useState(existingImages.find((image) => image.isPrimary)?.id ?? existingImages[0]?.id ?? '')
  const [variants, setVariants] = useState<VariantFormRow[]>(initialVariants)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/attribute-options?type=color').then((r) => r.json()),
      fetch('/api/attribute-options?type=material').then((r) => r.json()),
    ]).then(([colorData, materialData]) => {
      setColorOptions((colorData as { options: AttributeOption[] }).options ?? [])
      setMaterialOptions((materialData as { options: AttributeOption[] }).options ?? [])
    }).catch(() => {})
  }, [])

  const hasVariants = variants.length > 0
  const variantsValid = variants.every(
    (variant) =>
      variant.barcode.trim().length === 13 &&
      Number(variant.price) > 0 &&
      Number.isInteger(Number(variant.stockQuantity)) &&
      Number(variant.stockQuantity) >= 0,
  )
  const canSubmit =
    Boolean(categoryId) &&
    Boolean(colorOptionId) &&
    Boolean(materialOptionId) &&
    (!hasVariants ? barcode.trim().length === 13 : variantsValid)

  function updateVariant(localId: string, patch: Partial<VariantFormRow>) {
    setVariants((current) =>
      current.map((variant) => (variant.localId === localId ? { ...variant, ...patch } : variant)),
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSaved(false)

    try {
      const res = await fetch(`/api/seller/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          shortDescription,
          story,
          careInstructions,
          categoryId,
          colorOptionId: colorOptionId || undefined,
          materialOptionId: materialOptionId || undefined,
          price,
          compareAtPrice: compareAtPrice ? Number(compareAtPrice) : null,
          stockQuantity: stock,
          sku: sku.trim() || null,
          barcode: hasVariants ? null : barcode.trim(),
          variants: variants.map((variant) => ({
            ...(variant.dbId ? { id: variant.dbId } : {}),
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

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Bir hata olustu.')
        return
      }

      const existingIds = new Set(existingImages.map((img) => img.id))
      const newImages = images.filter((img) => !existingIds.has(img.id))
      if (newImages.length > 0) {
        await fetch(`/api/seller/products/${productId}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaAssetIds: newImages.map((img) => img.id) }),
        })
      }

      if (primaryImageId) {
        await fetch(`/api/seller/products/${productId}/images`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primaryImageId }),
        })
      }

      setSaved(true)
      router.refresh()
    } catch {
      setError('Baglanti hatasi.')
    } finally {
      setLoading(false)
    }
  }

  async function handleUnlist() {
    if (!confirm('Ürün yayından kaldırılacak. Devam edilsin mi?')) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/seller/products/${productId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Bir hata olustu.')
        setLoading(false)
      } else {
        window.location.href = '/urunler'
      }
    } catch {
      setError('Baglanti hatasi.')
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Ürün kalıcı olarak silinecek ve geri alınamaz. Emin misiniz?')) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/seller/products/${productId}?permanent=true`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Bir hata olustu.')
        setLoading(false)
      } else {
        window.location.href = '/urunler'
      }
    } catch {
      setError('Baglanti hatasi.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">Urun Adi *</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required disabled={loading} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="category">Kategori *</Label>
          <Select onValueChange={setCategoryId} value={categoryId}>
            <SelectTrigger id="edit-category" aria-label="Kategori" disabled={loading}>
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

        <div className="space-y-1.5">
          <Label htmlFor="price">Fiyat (TL) *</Label>
          <Input id="price" type="number" min={0} step={0.01} value={price} onChange={(e) => setPrice(Number(e.target.value))} required disabled={loading} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-color">Renk *</Label>
          <Select onValueChange={setColorOptionId} value={colorOptionId} disabled={loading}>
            <SelectTrigger id="edit-color" aria-label="Renk">
              <SelectValue placeholder="Renk secin" />
            </SelectTrigger>
            <SelectContent>
              {colorOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.hexColor && (
                    <span
                      className="mr-2 inline-block h-3 w-3 rounded-full border"
                      style={{ backgroundColor: opt.hexColor, borderColor: 'var(--color-border)' }}
                    />
                  )}
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-material">Materyal *</Label>
          <Select onValueChange={setMaterialOptionId} value={materialOptionId} disabled={loading}>
            <SelectTrigger id="edit-material" aria-label="Materyal">
              <SelectValue placeholder="Materyal secin" />
            </SelectTrigger>
            <SelectContent>
              {materialOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="compareAtPrice">Liste Fiyati (ustu cizili)</Label>
          <Input id="compareAtPrice" type="number" min={0} step={0.01} value={compareAtPrice} onChange={(e) => setCompareAtPrice(e.target.value)} disabled={loading} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="stock">Stok *</Label>
          <Input id="stock" type="number" min={0} value={stock} onChange={(e) => setStock(Number(e.target.value))} required disabled={loading || hasVariants} />
          {hasVariants ? <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>Stok varyasyon satirlarindan hesaplanir.</p> : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="barcode">Barkod (13 hane) *</Label>
          <Input
            id="barcode"
            inputMode="numeric"
            pattern="\d{13}"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value.replace(/\D/g, '').slice(0, 13))}
            required={!hasVariants}
            disabled={loading || hasVariants}
          />
          {hasVariants ? <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>Barkod varyasyon satirlarindan okunur.</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} disabled={loading} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Varyasyonlar</Label>
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>Renk, beden veya ek ozellik varsa her varyasyonu ayri barkodla girin.</p>
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
        <Label htmlFor="description">Aciklama</Label>
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
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>Ana gorseli yildiz dugmesiyle secebilirsiniz.</p>
        {existingImages.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {existingImages.map((image) => (
              <button
                key={image.id}
                type="button"
                className="relative h-20 w-20 overflow-hidden rounded-md border"
                style={{ borderColor: primaryImageId === image.id ? 'var(--color-primary)' : 'var(--color-border)' }}
                onClick={() => setPrimaryImageId(image.id)}
                aria-label="Ana gorsel sec"
              >
                <img
                  src={normalizeMediaDisplayUrl(image.url)}
                  alt={image.originalName ?? 'Urun gorseli'}
                  className="h-full w-full object-cover"
                />
                {primaryImageId === image.id ? (
                  <span className="absolute right-1 top-1 rounded-full bg-white/90 p-1" style={{ color: 'var(--color-primary)' }}>
                    <Star className="h-3 w-3 fill-current" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        <FileUpload
          folder="products"
          maxFiles={8}
          value={images}
          onChange={setImages}
          disabled={loading}
          inputLabel="Urun gorseli yukle"
          showPreviews
          imageConstraints={{
            minWidth: 800,
            minHeight: 800,
            maxWidth: 6000,
            maxHeight: 6000,
            allowedTypes: ['image/jpeg', 'image/png'],
          }}
        />
      </div>

      {error && <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>}
      {saved && <p className="text-sm" style={{ color: 'var(--color-success)' }}>Kaydedildi.</p>}

      {initialStatus === 'rejected' && (
        <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--color-destructive)', color: 'var(--color-destructive)' }}>
          Bu urun reddedildi. Duzenleyip tekrar gonderebilirsiniz.
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={loading || !canSubmit}>
          {loading ? 'Kaydediliyor...' : 'Kaydet'}
        </Button>
        <Button variant="outline" type="button" disabled={loading} onClick={handleUnlist}>
          Yayından Kaldır
        </Button>
        <Button variant="destructive" type="button" disabled={loading} onClick={handleDelete}>
          Sil
        </Button>
      </div>
    </form>
  )
}
