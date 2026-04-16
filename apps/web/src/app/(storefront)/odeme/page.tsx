'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Separator, Spinner } from '@hanuja/ui'
import { MapPin, CreditCard, Banknote, Plus, CheckCircle2, AlertTriangle, Lock } from 'lucide-react'

interface Address {
  id: string
  label: string | null
  fullName: string
  phone: string
  addressLine1: string
  addressLine2: string | null
  district: string
  city: string
  postalCode: string
  isDefault: boolean
}

interface CartSummary {
  itemCount: number
  subtotal: string
}

type PaymentMethod = 'card' | 'eft'

interface CardForm {
  cardHolderName: string
  cardNumber: string
  expireMonth: string
  expireYear: string
  cvc: string
}

const FREE_SHIPPING_THRESHOLD = 1500
const FLAT_SHIPPING = 99

function formatPrice(value: string | number) {
  return Number(value).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function CheckoutPage() {
  const router = useRouter()
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')
  const [cartSummary, setCartSummary] = useState<CartSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [cardForm, setCardForm] = useState<CardForm>({
    cardHolderName: '',
    cardNumber: '',
    expireMonth: '',
    expireYear: '',
    cvc: '',
  })
  const [cardErrors, setCardErrors] = useState<Partial<CardForm>>({})
  const hiddenFormRef = useRef<HTMLFormElement>(null)
  const [newAddress, setNewAddress] = useState({
    fullName: '',
    phone: '',
    addressLine1: '',
    district: '',
    city: '',
    postalCode: '',
    label: '',
  })

  const loadData = useCallback(async () => {
    try {
      const [cartRes, addrRes] = await Promise.all([
        fetch('/api/cart'),
        fetch('/api/checkout/addresses'),
      ])

      if (cartRes.status === 401 || addrRes.status === 401) {
        router.push('/giris?redirect=/odeme')
        return
      }

      const { data: cart } = await cartRes.json()
      const { data: addrs } = await addrRes.json()

      if (!cart?.itemCount || cart.itemCount === 0) {
        router.push('/sepet')
        return
      }

      setCartSummary({ itemCount: cart.itemCount, subtotal: cart.subtotal })
      setAddresses(addrs ?? [])

      // Varsayılan adresi seç
      const defaultAddr = (addrs ?? []).find((a: Address) => a.isDefault)
      if (defaultAddr) setSelectedAddressId(defaultAddr.id)
    } catch {
      setError('Sayfa yüklenirken hata oluştu')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function saveAddress() {
    if (!newAddress.fullName || !newAddress.addressLine1 || !newAddress.city) {
      setError('Ad soyad, adres ve şehir zorunludur')
      return
    }
    try {
      const res = await fetch('/api/checkout/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAddress),
      })
      if (!res.ok) {
        const body = await res.json()
        setError(body.message ?? 'Adres kaydedilemedi')
        return
      }
      const { data: saved } = await res.json()
      setAddresses((prev) => [...prev, saved])
      setSelectedAddressId(saved.id)
      setShowAddressForm(false)
      setNewAddress({ fullName: '', phone: '', addressLine1: '', district: '', city: '', postalCode: '', label: '' })
    } catch {
      setError('Adres kaydedilemedi')
    }
  }

  function validateCardForm(): boolean {
    const errs: Partial<CardForm> = {}
    if (!cardForm.cardHolderName.trim()) errs.cardHolderName = 'Ad zorunludur'
    const stripped = cardForm.cardNumber.replace(/\s/g, '')
    if (!/^\d{15,19}$/.test(stripped)) errs.cardNumber = 'Geçersiz kart numarası'
    if (!/^(0[1-9]|1[0-2])$/.test(cardForm.expireMonth)) errs.expireMonth = 'Geçersiz ay'
    if (!/^\d{4}$/.test(cardForm.expireYear)) errs.expireYear = 'Geçersiz yıl'
    if (!/^\d{3,4}$/.test(cardForm.cvc)) errs.cvc = 'Geçersiz CVC'
    setCardErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function placeOrder() {
    if (!selectedAddressId) {
      setError('Lütfen bir teslimat adresi seçin')
      return
    }

    if (paymentMethod === 'card') {
      if (!validateCardForm()) return
      // Kart ödemesi: hidden form aracılığıyla /api/payment/start'a submit et.
      // Bu endpoint Iyzico 3DS HTML'ini döner ve tarayıcı o sayfayı görüntüler.
      setSubmitting(true)
      hiddenFormRef.current?.submit()
      return
    }

    // EFT / Havale akışı
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/checkout/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addressId: selectedAddressId, paymentMethod: 'eft' }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.message ?? 'Sipariş oluşturulamadı')
        setSubmitting(false)
        return
      }
      const orderId = body.data.order.id
      router.push(`/siparis/${orderId}?yeni=1&odeme=eft`)
    } catch {
      setError('Sipariş oluşturulurken hata oluştu')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const subtotal = Number(cartSummary?.subtotal ?? 0)
  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING
  const total = subtotal + shipping

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <h1
        className="mb-8 text-2xl font-bold"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
      >
        Ödeme
      </h1>

      {error && (
        <div
          className="mb-6 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button className="ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Adım 1: Teslimat Adresi */}
          <section
            className="rounded-xl border p-6"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="h-5 w-5" style={{ color: 'var(--color-accent)' }} />
              <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                Teslimat Adresi
              </h2>
            </div>

            {addresses.length === 0 && !showAddressForm && (
              <p className="text-sm mb-3" style={{ color: 'var(--color-muted-fg)' }}>
                Kayıtlı adresiniz yok. Yeni adres ekleyin.
              </p>
            )}

            {/* Kayıtlı adresler */}
            <div className="space-y-3">
              {addresses.map((addr) => (
                <label
                  key={addr.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                  style={{
                    borderColor: selectedAddressId === addr.id
                      ? 'var(--color-accent)'
                      : 'var(--color-border)',
                    backgroundColor: selectedAddressId === addr.id
                      ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                      : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="address"
                    value={addr.id}
                    checked={selectedAddressId === addr.id}
                    onChange={() => setSelectedAddressId(addr.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                        {addr.fullName}
                      </span>
                      {addr.label && (
                        <span
                          className="rounded px-1.5 py-0.5 text-xs"
                          style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
                        >
                          {addr.label}
                        </span>
                      )}
                    </div>
                    <p style={{ color: 'var(--color-muted-fg)' }}>
                      {addr.addressLine1}
                      {addr.addressLine2 && `, ${addr.addressLine2}`}
                    </p>
                    <p style={{ color: 'var(--color-muted-fg)' }}>
                      {addr.district} / {addr.city} {addr.postalCode}
                    </p>
                    <p style={{ color: 'var(--color-muted-fg)' }}>{addr.phone}</p>
                  </div>
                  {selectedAddressId === addr.id && (
                    <CheckCircle2 className="h-4 w-4 mt-0.5" style={{ color: 'var(--color-accent)' }} />
                  )}
                </label>
              ))}
            </div>

            {/* Yeni adres formu */}
            {showAddressForm ? (
              <div
                className="mt-4 space-y-3 rounded-lg border p-4"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <h3 className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                  Yeni Adres
                </h3>
                {[
                  { key: 'fullName', label: 'Ad Soyad *', placeholder: 'Ad Soyad' },
                  { key: 'phone', label: 'Telefon *', placeholder: '05XX XXX XX XX' },
                  { key: 'addressLine1', label: 'Adres *', placeholder: 'Mahalle, sokak, bina no...' },
                  { key: 'district', label: 'İlçe *', placeholder: 'İlçe' },
                  { key: 'city', label: 'Şehir *', placeholder: 'İstanbul' },
                  { key: 'postalCode', label: 'Posta Kodu *', placeholder: '34000' },
                  { key: 'label', label: 'Etiket (isteğe bağlı)', placeholder: 'Ev, İş...' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="mb-1 block text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      {label}
                    </label>
                    <input
                      type="text"
                      placeholder={placeholder}
                      value={newAddress[key as keyof typeof newAddress]}
                      onChange={(e) =>
                        setNewAddress((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                      style={{
                        borderColor: 'var(--color-border)',
                        backgroundColor: 'var(--color-bg)',
                        color: 'var(--color-primary)',
                      }}
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveAddress}>
                    Kaydet
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddressForm(false)}>
                    İptal
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddressForm(true)}
                className="mt-3 flex items-center gap-1.5 text-sm"
                style={{ color: 'var(--color-accent)' }}
              >
                <Plus className="h-4 w-4" />
                Yeni adres ekle
              </button>
            )}
          </section>

          {/* Adım 2: Ödeme Yöntemi */}
          <section
            className="rounded-xl border p-6"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="h-5 w-5" style={{ color: 'var(--color-accent)' }} />
              <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                Ödeme Yöntemi
              </h2>
            </div>

            <div className="space-y-3">
              <label
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                style={{
                  borderColor: paymentMethod === 'card' ? 'var(--color-accent)' : 'var(--color-border)',
                  backgroundColor: paymentMethod === 'card'
                    ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                    : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="payment"
                  value="card"
                  checked={paymentMethod === 'card'}
                  onChange={() => setPaymentMethod('card')}
                />
                <CreditCard className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                    Kredi / Banka Kartı
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    Güvenli ödeme — Iyzico altyapısı
                  </p>
                </div>
              </label>

              {/* Kart formu — yalnızca card seçiliyken göster */}
              {paymentMethod === 'card' && (
                <div
                  className="rounded-lg border p-4 space-y-3"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Lock className="h-3.5 w-3.5" style={{ color: 'var(--color-muted-fg)' }} />
                    <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      Kart bilgileriniz şifreli iletilir, sunucularımızda saklanmaz.
                    </span>
                  </div>

                  {/* Kart üzerindeki isim */}
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                      Kart Üzerindeki İsim *
                    </label>
                    <input
                      type="text"
                      autoComplete="cc-name"
                      placeholder="Ad Soyad"
                      value={cardForm.cardHolderName}
                      onChange={(e) => setCardForm((p) => ({ ...p, cardHolderName: e.target.value }))}
                      className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                      style={{ borderColor: cardErrors.cardHolderName ? 'var(--color-danger)' : 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-primary)' }}
                    />
                    {cardErrors.cardHolderName && (
                      <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>{cardErrors.cardHolderName}</p>
                    )}
                  </div>

                  {/* Kart numarası */}
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                      Kart Numarası *
                    </label>
                    <input
                      type="text"
                      autoComplete="cc-number"
                      inputMode="numeric"
                      placeholder="0000 0000 0000 0000"
                      maxLength={19}
                      value={cardForm.cardNumber}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 16)
                        const formatted = v.replace(/(.{4})/g, '$1 ').trim()
                        setCardForm((p) => ({ ...p, cardNumber: formatted }))
                      }}
                      className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 font-mono"
                      style={{ borderColor: cardErrors.cardNumber ? 'var(--color-danger)' : 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-primary)' }}
                    />
                    {cardErrors.cardNumber && (
                      <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>{cardErrors.cardNumber}</p>
                    )}
                  </div>

                  {/* Son kullanma tarihi + CVC */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                        Ay *
                      </label>
                      <input
                        type="text"
                        autoComplete="cc-exp-month"
                        inputMode="numeric"
                        placeholder="MM"
                        maxLength={2}
                        value={cardForm.expireMonth}
                        onChange={(e) => setCardForm((p) => ({ ...p, expireMonth: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
                        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 text-center"
                        style={{ borderColor: cardErrors.expireMonth ? 'var(--color-danger)' : 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-primary)' }}
                      />
                      {cardErrors.expireMonth && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>{cardErrors.expireMonth}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                        Yıl *
                      </label>
                      <input
                        type="text"
                        autoComplete="cc-exp-year"
                        inputMode="numeric"
                        placeholder="YYYY"
                        maxLength={4}
                        value={cardForm.expireYear}
                        onChange={(e) => setCardForm((p) => ({ ...p, expireYear: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 text-center"
                        style={{ borderColor: cardErrors.expireYear ? 'var(--color-danger)' : 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-primary)' }}
                      />
                      {cardErrors.expireYear && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>{cardErrors.expireYear}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                        CVC *
                      </label>
                      <input
                        type="text"
                        autoComplete="cc-csc"
                        inputMode="numeric"
                        placeholder="123"
                        maxLength={4}
                        value={cardForm.cvc}
                        onChange={(e) => setCardForm((p) => ({ ...p, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 text-center"
                        style={{ borderColor: cardErrors.cvc ? 'var(--color-danger)' : 'var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-primary)' }}
                      />
                      {cardErrors.cvc && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>{cardErrors.cvc}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <label
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                style={{
                  borderColor: paymentMethod === 'eft' ? 'var(--color-accent)' : 'var(--color-border)',
                  backgroundColor: paymentMethod === 'eft'
                    ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                    : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="payment"
                  value="eft"
                  checked={paymentMethod === 'eft'}
                  onChange={() => setPaymentMethod('eft')}
                />
                <Banknote className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                    Havale / EFT
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    Sipariş sonrası banka bilgileri gösterilir
                  </p>
                </div>
              </label>
            </div>
          </section>
        </div>

        {/* Sipariş özeti */}
        <div
          className="h-fit rounded-xl border p-6"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Sipariş Özeti
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
              <span>{cartSummary?.itemCount ?? 0} ürün</span>
              <span>₺{formatPrice(subtotal)}</span>
            </div>
            <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
              <span>Kargo</span>
              <span>
                {shipping === 0 ? (
                  <span style={{ color: 'var(--color-success)' }}>Ücretsiz</span>
                ) : (
                  `₺${shipping}`
                )}
              </span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold text-base" style={{ color: 'var(--color-primary)' }}>
              <span>Toplam</span>
              <span>₺{formatPrice(total)}</span>
            </div>
          </div>

          <Button
            className="mt-6 w-full"
            size="lg"
            onClick={placeOrder}
            disabled={submitting || !selectedAddressId}
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Spinner className="h-4 w-4" />
                İşleniyor...
              </span>
            ) : paymentMethod === 'card' ? (
              'Ödemeye Geç'
            ) : (
              'Siparişi Onayla'
            )}
          </Button>

          <p className="mt-3 text-center text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Siparişi onaylayarak{' '}
            <a href="/sayfa/kullanim-kosullari" className="underline">
              kullanım koşullarını
            </a>{' '}
            kabul etmiş olursunuz.
          </p>
        </div>
      </div>

      {/*
        Hidden form — kart ödemesinde /api/payment/start'a POST eder.
        Tarayıcı bu formu submit ettiğinde sunucu 3DS HTML döner ve sayfa değişir.
        Kart verileri form üzerinden güvenli iletilir, React state'de yalnızca geçici tutulur.
      */}
      <form
        ref={hiddenFormRef}
        method="POST"
        action="/api/payment/start"
        style={{ display: 'none' }}
        encType="application/x-www-form-urlencoded"
      >
        <input type="hidden" name="addressId" value={selectedAddressId ?? ''} />
        <input type="hidden" name="cardHolderName" value={cardForm.cardHolderName} />
        <input type="hidden" name="cardNumber" value={cardForm.cardNumber.replace(/\s/g, '')} />
        <input type="hidden" name="expireMonth" value={cardForm.expireMonth} />
        <input type="hidden" name="expireYear" value={cardForm.expireYear} />
        <input type="hidden" name="cvc" value={cardForm.cvc} />
      </form>
    </div>
  )
}
