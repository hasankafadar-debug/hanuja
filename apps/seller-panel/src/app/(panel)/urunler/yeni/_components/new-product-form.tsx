'use client'

import { useState, useEffect, useMemo } from 'react'
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
import { sortAttributeOptions } from '@/lib/attribute-option-sort'
import { useBarcodeAvailability, type BarcodeAvailabilityStatus } from '@/lib/use-barcode-availability'
import CategoryPicker from '../../_components/category-picker'
import { CategorySupportHint } from '../../_components/category-support-hint'
import type { CategoryNode } from '../../_lib/category-tree'

interface AttributeOption {
  id: string
  slug: string
  label: string
  hexColor: string | null
  sortOrder?: number
}

interface Props {
  categories: CategoryNode[]
}

interface VariantFormRow {
  localId: string
  color: string
  material: string
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
    material: '',
    size: '',
    customOptionName: '',
    customOptionValue: '',
    barcode: '',
    price: '',
    stockQuantity: '',
  }
}

function BarcodeStatusHint({ status, message, hidden = false }: { status: BarcodeAvailabilityStatus; message: string | null; hidden?: boolean }) {
  if (hidden || status === 'idle') return null
  const color = status === 'available'
    ? 'var(--color-success)'
    : status === 'checking'
      ? 'var(--color-muted-fg)'
      : 'var(--color-destructive)'
  const fallback = status === 'available'
    ? 'Barkod kullanilabilir.'
    : status === 'in_use'
      ? 'Bu barkod baska bir urun veya varyantta kullanilmistir.'
      : 'Barkod kontrol ediliyor...'
  return <p className="text-xs" style={{ color }}>{message ?? fallback}</p>
}

export default function NewProductForm({ categories }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [colorOptionId, setColorOptionId] = useState('')
  // Renk adedi: 1 → tek renk; 2 → Renk 1 + Renk 2 ayrı seçilir. 2'den fazla renk
  // için satıcı adedi 1 tutup "Mix" seçebilir.
  const [colorCount, setColorCount] = useState<1 | 2>(1)
  const [secondColorOptionId, setSecondColorOptionId] = useState('')
  const [materialOptionId, setMaterialOptionId] = useState('')
  const [colorOptions, setColorOptions] = useState<AttributeOption[]>([])
  const [materialOptions, setMaterialOptions] = useState<AttributeOption[]>([])
  const [price, setPrice] = useState('')
  // Bilinçli olarak boş başlar: sevk süresi ürüne özeldir, satıcı açıkça girmek zorundadır
  const [fulfillmentDays, setFulfillmentDays] = useState('')
  const [compareAtPrice, setCompareAtPrice] = useState('')
  const [stock, setStock] = useState('')
  const [barcode, setBarcode] = useState('')
  const [sku, setSku] = useState('')
  const [modelCode, setModelCode] = useState('')
  // Boyutlar (cm) — opsiyonel. En → dimensionWidth, Boy → dimensionLength, Yükseklik → dimensionHeight.
  const [dimWidth, setDimWidth] = useState('')
  const [dimLength, setDimLength] = useState('')
  const [dimHeight, setDimHeight] = useState('')
  const [shortDescription, setShortDescription] = useState('')
  const [description, setDescription] = useState('')
  const [story, setStory] = useState('')
  const [careInstructions, setCareInstructions] = useState('')
  const [images, setImages] = useState<UploadedAsset[]>([])
  const [pendingImageUploads, setPendingImageUploads] = useState(0)
  const [variants, setVariants] = useState<VariantFormRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryProductId, setRecoveryProductId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/attribute-options?type=color').then((r) => r.json()),
      fetch('/api/attribute-options?type=material').then((r) => r.json()),
    ]).then(([colorData, materialData]) => {
      setColorOptions(sortAttributeOptions((colorData as { options: AttributeOption[] }).options ?? []))
      setMaterialOptions(sortAttributeOptions((materialData as { options: AttributeOption[] }).options ?? []))
    }).catch(() => {})
  }, [])

  const hasVariants = variants.length > 0
  const barcodeCheckItems = useMemo(
    () => [
      ...(!hasVariants ? [{ key: 'product', barcode }] : []),
      ...variants.map((variant) => ({ key: variant.localId, barcode: variant.barcode })),
    ],
    [barcode, hasVariants, variants],
  )
  const { getResult: getBarcodeResult } = useBarcodeAvailability(barcodeCheckItems)
  const requiredBarcodeKeys = hasVariants ? variants.map((variant) => variant.localId) : ['product']
  const hasBarcodeCheckIssue = requiredBarcodeKeys.some((key) => {
    const status = getBarcodeResult(key).status
    return status === 'checking' || status === 'invalid' || status === 'duplicate_in_request' || status === 'in_use' || status === 'error'
  })
  const totalVariantStock = variants.reduce((sum, variant) => sum + Number(variant.stockQuantity || 0), 0)
  const variantsValid = variants.every(
    (variant) =>
      Number(variant.price) > 0 &&
      Number.isInteger(Number(variant.stockQuantity)) &&
      Number(variant.stockQuantity) >= 0,
  )
  const secondColorMissing = colorCount === 2 && !secondColorOptionId
  const submitDisabled =
    loading ||
    !categoryId ||
    !colorOptionId ||
    secondColorMissing ||
    !materialOptionId ||
    Number(fulfillmentDays) < 1 ||
    pendingImageUploads > 0 ||
    !modelCode.trim() ||
    hasBarcodeCheckIssue ||
    (hasVariants && !variantsValid)
  const missingSubmitReason = !categoryId
    ? 'Urunu gondermek icin kategori secin.'
    : !colorOptionId
      ? 'Urunu gondermek icin renk secin.'
      : secondColorMissing
        ? 'Renk adedi 2 secildiginde ikinci rengi de secin.'
        : !materialOptionId
        ? 'Urunu gondermek icin materyal secin.'
        : Number(fulfillmentDays) < 1
          ? 'Urunu gondermek icin sevk suresi girin.'
          : pendingImageUploads > 0
            ? 'Gorsel yuklemeleri tamamlanmadan urun gonderilemez.'
            : !modelCode.trim()
              ? 'Urunu gondermek icin Model Kodu girin.'
              : hasBarcodeCheckIssue
                ? 'Barkod kontrolleri tamamlanmadan urun gonderilemez.'
            : hasVariants && !variantsValid
              ? 'Varyasyonlu urunlerde her satir icin fiyat ve stok girin.'
                : null

  async function attachProductImages(productId: string, mediaAssetIds: string[]) {
    const response = await fetch(`/api/seller/products/${productId}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaAssetIds }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.error ?? 'Gorseller urune baglanamadi.')
    }
  }

  function updateVariant(localId: string, patch: Partial<VariantFormRow>) {
    setVariants((current) =>
      current.map((variant) => (variant.localId === localId ? { ...variant, ...patch } : variant)),
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setRecoveryProductId(null)

    try {
      const res = await fetch('/api/seller/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          categoryId,
          colorOptionId,
          secondColorOptionId:
            colorCount === 2 && secondColorOptionId ? secondColorOptionId : undefined,
          materialOptionId,
          price: parseFloat(price),
          fulfillmentDays: parseInt(fulfillmentDays, 10),
          compareAtPrice: compareAtPrice ? parseFloat(compareAtPrice) : undefined,
          stockQuantity: parseInt(stock || '0', 10),
          barcode: hasVariants ? null : barcode.trim(),
          sku: sku.trim() || undefined,
          modelCode: modelCode.trim(),
          dimensionWidth: dimWidth.trim() ? parseFloat(dimWidth) : undefined,
          dimensionLength: dimLength.trim() ? parseFloat(dimLength) : undefined,
          dimensionHeight: dimHeight.trim() ? parseFloat(dimHeight) : undefined,
          shortDescription,
          description,
          story,
          careInstructions,
          variants: variants.map((variant) => ({
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
        try {
          await attachProductImages(productId, images.map((img) => img.id))
        } catch (attachError) {
          setRecoveryProductId(productId)
          setError(
            attachError instanceof Error
              ? `Urun olusturuldu fakat gorseller baglanamadi. Lutfen Urunlerim sayfasindan urunu duzenleyip tekrar deneyin. Detay: ${attachError.message}`
              : 'Urun olusturuldu fakat gorseller baglanamadi. Lutfen Urunlerim sayfasindan urunu duzenleyip tekrar deneyin.',
          )
          return
        }
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

      <CategoryPicker
        categories={categories}
        value={categoryId}
        onChange={setCategoryId}
        disabled={loading}
      />
      <CategorySupportHint />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="colorCount">Renk Adedi *</Label>
          <Select
            value={String(colorCount)}
            onValueChange={(value) => {
              const next = value === '2' ? 2 : 1
              setColorCount(next)
              if (next === 1) setSecondColorOptionId('')
            }}
            disabled={loading}
          >
            <SelectTrigger id="colorCount" aria-label="Renk Adedi">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Tek renk</SelectItem>
              <SelectItem value="2">Iki renk</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="material">Materyal *</Label>
          <Select onValueChange={setMaterialOptionId} value={materialOptionId} disabled={loading}>
            <SelectTrigger id="material" aria-label="Materyal">
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="color">{colorCount === 2 ? 'Renk 1 *' : 'Renk *'}</Label>
          <Select onValueChange={setColorOptionId} value={colorOptionId} disabled={loading}>
            <SelectTrigger id="color" aria-label={colorCount === 2 ? 'Renk 1' : 'Renk'}>
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
          {colorCount === 1 ? (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Ikiden fazla renk varsa &quot;Mix&quot; secebilirsiniz.
            </p>
          ) : null}
        </div>
        {colorCount === 2 ? (
          <div className="space-y-1.5">
            <Label htmlFor="secondColor">Renk 2 *</Label>
            <Select onValueChange={setSecondColorOptionId} value={secondColorOptionId} disabled={loading}>
              <SelectTrigger id="secondColor" aria-label="Renk 2">
                <SelectValue placeholder="Ikinci rengi secin" />
              </SelectTrigger>
              <SelectContent>
                {colorOptions
                  .filter((opt) => opt.id !== colorOptionId)
                  .map((opt) => (
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
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Magazada &quot;Renk: Renk1 - Renk2&quot; olarak gosterilir.
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="price">Fiyat (TL) *</Label>
          <Input id="price" type="number" min="0" step="0.01" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} required disabled={loading} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fulfillmentDays">Sevk Suresi (is gunu) *</Label>
          <Input id="fulfillmentDays" type="number" min="1" step="1" placeholder="Orn. 7" value={fulfillmentDays} onChange={(e) => setFulfillmentDays(e.target.value)} required disabled={loading} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="compareAtPrice">Liste Fiyati (ustu cizili)</Label>
          <Input id="compareAtPrice" type="number" min="0" step="0.01" placeholder="Istege bagli" value={compareAtPrice} onChange={(e) => setCompareAtPrice(e.target.value)} disabled={loading} />
        </div>
        <div />
      </div>

      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Indirim gostermek isterseniz liste fiyatini satis fiyatindan yuksek girin.
      </p>

      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="stock">Stok Adedi *</Label>
        <Input id="stock" type="number" min="0" placeholder="0" value={stock} onChange={(e) => setStock(e.target.value)} required disabled={loading || hasVariants} />
        {hasVariants ? (
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Varyasyonlu urunde stok varyasyon satirlarindan hesaplanir. Toplam: {totalVariantStock}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="barcode">Barkod (13 hane)</Label>
          <Input
            id="barcode"
            inputMode="numeric"
            pattern="\d{13}"
            placeholder="Bos birakilirsa otomatik uretilir"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value.replace(/\D/g, '').slice(0, 13))}
            disabled={loading || hasVariants}
          />
          {hasVariants ? (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Varyasyonlu urunde barkod varyasyon satirlarindan okunur.
            </p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Istege baglidir. Bos birakirsaniz 8 ile baslayan benzersiz 13 haneli barkod otomatik uretilir.
            </p>
          )}
          <BarcodeStatusHint status={getBarcodeResult('product').status} message={getBarcodeResult('product').message} hidden={hasVariants} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="modelCode">Model Kodu *</Label>
          <Input id="modelCode" placeholder="SEHPA-001" value={modelCode} onChange={(e) => setModelCode(e.target.value)} required disabled={loading} />
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Ayni Model Kodu, ayni modelin renk veya materyal seceneklerini urun detayinda birlikte gosterir.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" placeholder="SEHPA-001" value={sku} onChange={(e) => setSku(e.target.value)} disabled={loading} />
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Saticinin kendi sistemindeki istege bagli kodudur; varyant iliskilendirmesinde kullanilmaz.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Olculer (cm) — istege bagli</Label>
        <div className="grid grid-cols-3 gap-4">
          <Input
            aria-label="En (cm)"
            type="number"
            min="0"
            step="0.1"
            placeholder="En"
            value={dimWidth}
            onChange={(e) => setDimWidth(e.target.value)}
            disabled={loading}
          />
          <Input
            aria-label="Boy (cm)"
            type="number"
            min="0"
            step="0.1"
            placeholder="Boy"
            value={dimLength}
            onChange={(e) => setDimLength(e.target.value)}
            disabled={loading}
          />
          <Input
            aria-label="Yukseklik (cm)"
            type="number"
            min="0"
            step="0.1"
            placeholder="Yukseklik"
            value={dimHeight}
            onChange={(e) => setDimHeight(e.target.value)}
            disabled={loading}
          />
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Girilirse urun sayfasinda gosterilir. Bos birakabilirsiniz.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Varyasyonlar</Label>
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Beden, olcu veya ek ozellik varsa her varyasyonu ayri barkodla girin. Farkli renk veya materyal kardeslerini baglamak icin ayni Model Kodunu kullanin.
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
              <Input placeholder="Beden" value={variant.size} onChange={(e) => updateVariant(variant.localId, { size: e.target.value })} disabled={loading} />
              <Input placeholder="Ek Ozellik Adi" value={variant.customOptionName} onChange={(e) => updateVariant(variant.localId, { customOptionName: e.target.value })} disabled={loading} />
              <Input placeholder="Ek Ozellik Degeri" value={variant.customOptionValue} onChange={(e) => updateVariant(variant.localId, { customOptionValue: e.target.value })} disabled={loading} />
              <Input inputMode="numeric" pattern="\d{13}" placeholder="Barkod (bos = otomatik)" value={variant.barcode} onChange={(e) => updateVariant(variant.localId, { barcode: e.target.value.replace(/\D/g, '').slice(0, 13) })} disabled={loading} />
              <BarcodeStatusHint status={getBarcodeResult(variant.localId).status} message={getBarcodeResult(variant.localId).message} />
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
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          1:1 tavsiye edilir. Farkli oranlar kabul edilir; kare alanlarda uygun sekilde kirpilarak gosterilir.
        </p>
        <FileUpload
          folder="products"
          maxFiles={8}
          value={images}
          onChange={setImages}
          onPendingChange={setPendingImageUploads}
          disabled={loading}
          showPreviews
          imageConstraints={{
            minWidth: 800,
            minHeight: 800,
            maxWidth: 6000,
            maxHeight: 6000,
            allowedTypes: ['image/jpeg', 'image/png'],
          }}
          inputLabel="Urun gorseli yukle"
        />
        {pendingImageUploads > 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Gorsel yuklemeleri tamamlanmadan urun gonderilemez.
          </p>
        ) : null}
      </div>

      {error && <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>}
      {recoveryProductId ? (
        <Button type="button" variant="outline" onClick={() => router.push(`/urunler/${recoveryProductId}`)}>
          Olusan urunu duzenle
        </Button>
      ) : null}

      <div className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}>
        <p style={{ color: 'var(--color-muted-fg)' }}>
          Yeni urunler admin incelemesine girebilir. Onaylanmis bir urunde sonraki duzenlemeler yeniden onay beklemeden yayinlanir.
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
