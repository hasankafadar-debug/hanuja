'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Banknote, CheckCircle2, CreditCard, FileText, Lock, MapPin, Plus } from 'lucide-react'
import { Button, Separator, Spinner, TurnstileWidget } from '@hanuja/ui'
import LegalDocumentDialog from '@/components/legal-document-dialog'
import { csrfFetch } from '@/lib/csrf-fetch'

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
  isBillingAddress: boolean
  invoiceType: 'individual' | 'corporate' | null
  companyName: string | null
}

interface CartSummary {
  itemCount: number
  subtotal: string
  grossSubtotal?: string
  couponDiscount?: string
  eftDiscount?: string
  shipping?: string
  total?: string
  eftDiscountRatePercent?: number
  freeShippingThresholdTry: string
  flatShippingFeeTry: string
}

interface LegalPreview {
  distanceSalesHtml: string
  preInformationHtml: string
}

type PaymentMethod = 'card' | 'eft'

interface CardForm {
  cardHolderName: string
  cardNumber: string
  expireMonth: string
  expireYear: string
  cvc: string
  identityNumber: string
}

type CheckoutPageClientProps = {
  cardPaymentsEnabled: boolean
  turnstileSiteKey?: string | undefined
}

function formatPrice(value: string | number) {
  const formatted = Number(value).toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return `${formatted} TL`
}

export function CheckoutPageClient({ cardPaymentsEnabled, turnstileSiteKey }: CheckoutPageClientProps) {
  const router = useRouter()
  const selectedOptionBorderColor = 'var(--color-success)'

  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    cardPaymentsEnabled ? 'card' : 'eft',
  )
  const [cartSummary, setCartSummary] = useState<CartSummary | null>(null)
  const [legalPreview, setLegalPreview] = useState<LegalPreview | null>(null)
  const [legalLoading, setLegalLoading] = useState(false)
  const [legalError, setLegalError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [useDifferentBilling, setUseDifferentBilling] = useState(false)
  const [selectedBillingAddressId, setSelectedBillingAddressId] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [cardForm, setCardForm] = useState<CardForm>({
    cardHolderName: '',
    cardNumber: '',
    expireMonth: '',
    expireYear: '',
    cvc: '',
    identityNumber: '',
  })
  const [cardErrors, setCardErrors] = useState<Partial<CardForm>>({})
  const [acceptedMesafeliSatis, setAcceptedMesafeliSatis] = useState(false)
  const [acceptedOnBilgilendirme, setAcceptedOnBilgilendirme] = useState(false)
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
        fetch('/api/cart', { cache: 'no-store' }),
        fetch('/api/checkout/addresses', { cache: 'no-store' }),
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

      setCartSummary({
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
        grossSubtotal: cart.grossSubtotal ?? cart.subtotal,
        couponDiscount: cart.couponDiscount ?? '0',
        eftDiscount: cart.eftDiscount ?? '0',
        shipping: cart.shipping ?? '0',
        total: cart.total ?? cart.subtotal,
        eftDiscountRatePercent: Number(cart.eftDiscountRatePercent ?? 0),
        freeShippingThresholdTry: cart.freeShippingThresholdTry ?? '1500',
        flatShippingFeeTry: cart.flatShippingFeeTry ?? '99',
      })
      setAddresses(addrs ?? [])

      const defaultAddress = (addrs ?? []).find((address: Address) => address.isDefault)
      if (defaultAddress) {
        setSelectedAddressId(defaultAddress.id)
      }
    } catch {
      setError('Sayfa yüklenirken hata oluştu.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    setAcceptedMesafeliSatis(false)
    setAcceptedOnBilgilendirme(false)
  }, [paymentMethod, selectedAddressId, selectedBillingAddressId, useDifferentBilling])

  useEffect(() => {
    if (!selectedAddressId) {
      setLegalPreview(null)
      setLegalError(null)
      setLegalLoading(false)
      return
    }

    let cancelled = false
    const addressId = selectedAddressId

    async function loadLegalPreview() {
      setLegalLoading(true)
      setLegalError(null)

      try {
        const res = await fetch(
          `/api/checkout/contracts-preview?addressId=${encodeURIComponent(addressId)}&paymentMethod=${paymentMethod}${useDifferentBilling && selectedBillingAddressId ? `&billingAddressId=${encodeURIComponent(selectedBillingAddressId)}` : ''}`,
          { cache: 'no-store' },
        )

        if (res.status === 401) {
          router.push('/giris?redirect=/odeme')
          return
        }

        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(body.message ?? 'Sözleşmeler hazırlanamadı.')
        }

        if (!cancelled) {
          setLegalPreview(body.data as LegalPreview)
        }
      } catch (err) {
        if (!cancelled) {
          setLegalPreview(null)
          setLegalError(err instanceof Error ? err.message : 'Sözleşmeler hazırlanamadı.')
        }
      } finally {
        if (!cancelled) {
          setLegalLoading(false)
        }
      }
    }

    void loadLegalPreview()

    return () => {
      cancelled = true
    }
  }, [paymentMethod, router, selectedAddressId, selectedBillingAddressId, useDifferentBilling])

  async function saveAddress() {
    if (!newAddress.fullName || !newAddress.addressLine1 || !newAddress.city) {
      setError('Ad soyad, adres ve şehir zorunludur.')
      return
    }

    try {
      const res = await csrfFetch('/api/checkout/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAddress),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.message ?? 'Adres kaydedilemedi.')
        return
      }

      const { data: saved } = await res.json()
      setAddresses((prev) => [...prev, saved])
      setSelectedAddressId(saved.id)
      setShowAddressForm(false)
      setNewAddress({
        fullName: '',
        phone: '',
        addressLine1: '',
        district: '',
        city: '',
        postalCode: '',
        label: '',
      })
    } catch {
      setError('Adres kaydedilemedi.')
    }
  }

  function validateCardForm(): boolean {
    const nextErrors: Partial<CardForm> = {}

    if (!cardForm.cardHolderName.trim()) {
      nextErrors.cardHolderName = 'Ad zorunludur.'
    }

    const stripped = cardForm.cardNumber.replace(/\s/g, '')
    if (!/^\d{15,19}$/.test(stripped)) {
      nextErrors.cardNumber = 'Geçersiz kart numarası.'
    }

    if (!/^(0[1-9]|1[0-2])$/.test(cardForm.expireMonth)) {
      nextErrors.expireMonth = 'Geçersiz ay.'
    }

    if (!/^\d{4}$/.test(cardForm.expireYear)) {
      nextErrors.expireYear = 'Geçersiz yıl.'
    }

    if (!/^\d{3,4}$/.test(cardForm.cvc)) {
      nextErrors.cvc = 'Geçersiz CVC.'
    }

    if (!/^\d{11}$/.test(cardForm.identityNumber)) {
      nextErrors.identityNumber = 'TC kimlik numarası 11 haneli rakam olmalı.'
    }

    setCardErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function placeOrder() {
    if (!selectedAddressId) {
      setError('Lütfen bir teslimat adresi seçin.')
      return
    }

    if (!legalPreview || legalLoading) {
      setError('Siparişe özel sözleşmeler henüz hazır değil. Lütfen biraz sonra tekrar deneyin.')
      return
    }

    if (!acceptedMesafeliSatis || !acceptedOnBilgilendirme) {
      setError('Devam etmek için sözleşmeleri onaylayın.')
      return
    }

    if (!turnstileToken) {
      setError('Devam etmeden önce insan doğrulamasını tamamlayın.')
      return
    }

    if (paymentMethod === 'card') {
      if (!validateCardForm()) {
        return
      }

      setSubmitting(true)
      setError(null)

      try {
        const res = await csrfFetch('/api/payment/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addressId: selectedAddressId,
            ...(useDifferentBilling && selectedBillingAddressId
              ? { billingAddressId: selectedBillingAddressId }
              : {}),
            cardHolderName: cardForm.cardHolderName,
            cardNumber: cardForm.cardNumber.replace(/\s/g, ''),
            expireMonth: cardForm.expireMonth,
            expireYear: cardForm.expireYear,
            cvc: cardForm.cvc,
            identityNumber: cardForm.identityNumber,
            turnstileToken,
            acceptedDistanceSales: true,
            acceptedPreInformation: true,
          }),
        })

        const html = await res.text()
        document.open()
        document.write(html)
        document.close()
      } catch {
        setError('Ödeme başlatılırken hata oluştu. Lütfen tekrar deneyin.')
        setSubmitting(false)
      }

      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const res = await csrfFetch('/api/checkout/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addressId: selectedAddressId,
          ...(useDifferentBilling && selectedBillingAddressId
            ? { billingAddressId: selectedBillingAddressId }
            : {}),
          paymentMethod: 'eft',
          turnstileToken,
          acceptedDistanceSales: true,
          acceptedPreInformation: true,
        }),
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.message ?? 'Sipariş oluşturulamadı.')
        setSubmitting(false)
        return
      }

      const orderId = body.data.order.id
      router.push(`/siparis/${orderId}?yeni=1&odeme=eft`)
    } catch {
      setError('Sipariş oluşturulurken hata oluştu.')
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

  const grossSubtotal = Number(cartSummary?.grossSubtotal ?? cartSummary?.subtotal ?? 0)
  const couponDiscount = Number(cartSummary?.couponDiscount ?? 0)
  const eftDiscount = paymentMethod === 'eft' ? Number(cartSummary?.eftDiscount ?? 0) : 0
  const freeShippingThreshold = Number(cartSummary?.freeShippingThresholdTry ?? 1500)
  const flatShippingFee = Number(cartSummary?.flatShippingFeeTry ?? 99)
  const shipping = Number(cartSummary?.shipping ?? (grossSubtotal >= freeShippingThreshold ? 0 : flatShippingFee))
  const total = paymentMethod === 'eft'
    ? grossSubtotal - couponDiscount - eftDiscount + shipping
    : Number(cartSummary?.total ?? (grossSubtotal - couponDiscount + shipping))
  const hasAddress = Boolean(selectedAddressId)
  const documentsReady = hasAddress && Boolean(legalPreview) && !legalLoading && !legalError

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <h1
        className="mb-8 text-2xl font-medium"
        style={{ fontFamily: 'var(--font-display)', color: '#3d3529' }}
      >
        Ödeme
      </h1>

      {error ? (
        <div
          className="mb-6 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button type="button" className="ml-auto" onClick={() => setError(null)}>
            x
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section
            className="rounded-xl border p-6"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <MapPin className="h-5 w-5" style={{ color: 'var(--color-accent)' }} />
              <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                Teslimat Adresi
              </h2>
            </div>

            {addresses.length === 0 && !showAddressForm ? (
              <p className="mb-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Kayıtlı adresiniz yok. Yeni adres ekleyin.
              </p>
            ) : null}

            <div className="space-y-3">
              {addresses.filter((a) => !a.isBillingAddress).map((address) => (
                <label
                  key={address.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                  style={{
                    borderColor:
                      selectedAddressId === address.id
                        ? selectedOptionBorderColor
                        : 'var(--color-border)',
                  }}
                >
                  <input
                    type="radio"
                    name="address"
                    value={address.id}
                    checked={selectedAddressId === address.id}
                    onChange={() => setSelectedAddressId(address.id)}
                    className="mt-0.5"
                    style={{ accentColor: selectedOptionBorderColor }}
                  />
                  <div className="flex-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                        {address.fullName}
                      </span>
                      {address.label ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-xs"
                          style={{
                            backgroundColor: 'var(--color-muted)',
                            color: 'var(--color-muted-fg)',
                          }}
                        >
                          {address.label}
                        </span>
                      ) : null}
                    </div>
                    <p style={{ color: 'var(--color-muted-fg)' }}>
                      {address.addressLine1}
                      {address.addressLine2 ? `, ${address.addressLine2}` : ''}
                    </p>
                    <p style={{ color: 'var(--color-muted-fg)' }}>
                      {[address.district, '/', address.city, address.postalCode].filter(Boolean).join(' ')}
                    </p>
                    <p style={{ color: 'var(--color-muted-fg)' }}>{address.phone}</p>
                  </div>
                  {selectedAddressId === address.id ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4" style={{ color: selectedOptionBorderColor }} />
                  ) : null}
                </label>
              ))}
            </div>

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
                  { key: 'city', label: 'Şehir *', placeholder: 'İzmir' },
                  { key: 'postalCode', label: 'Posta Kodu', placeholder: '35000' },
                  { key: 'label', label: 'Etiket', placeholder: 'Ev, İş...' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="mb-1 block text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      {label}
                    </label>
                    <input
                      type="text"
                      placeholder={placeholder}
                      value={newAddress[key as keyof typeof newAddress]}
                      onChange={(event) =>
                        setNewAddress((prev) => ({ ...prev, [key]: event.target.value }))
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
                type="button"
                onClick={() => setShowAddressForm(true)}
                className="mt-3 flex items-center gap-1.5 text-sm"
                style={{ color: 'var(--color-accent)' }}
              >
                <Plus className="h-4 w-4" />
                Yeni adres ekle
              </button>
            )}
          </section>

          {/* Farklı fatura adresi bölümü */}
          <section
            className="rounded-xl border p-6"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={useDifferentBilling}
                onChange={(e) => {
                  setUseDifferentBilling(e.target.checked)
                  if (!e.target.checked) setSelectedBillingAddressId(null)
                }}
                className="h-4 w-4 rounded"
                style={{ accentColor: 'var(--color-accent)' }}
              />
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                  Farklı fatura adresi kullan
                </span>
              </div>
            </label>

            {useDifferentBilling && (
              <div className="mt-4">
                {(() => {
                  const billingAddrs = addresses.filter((a) => a.isBillingAddress)
                  if (billingAddrs.length === 0) {
                    return (
                      <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                        Kayıtlı fatura adresiniz yok.{' '}
                        <a
                          href="/hesabim/adresler"
                          className="underline"
                          style={{ color: 'var(--color-accent)' }}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Adreslerim
                        </a>
                        {' '}sayfasından yeni fatura adresi ekleyebilirsiniz.
                      </p>
                    )
                  }
                  return (
                    <div className="space-y-3">
                      {billingAddrs.map((addr) => (
                        <label
                          key={addr.id}
                          className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                          style={{
                            borderColor:
                              selectedBillingAddressId === addr.id
                                ? selectedOptionBorderColor
                                : 'var(--color-border)',
                          }}
                        >
                          <input
                            type="radio"
                            name="billingAddress"
                            value={addr.id}
                            checked={selectedBillingAddressId === addr.id}
                            onChange={() => setSelectedBillingAddressId(addr.id)}
                            className="mt-0.5"
                            style={{ accentColor: selectedOptionBorderColor }}
                          />
                          <div className="flex-1 text-sm">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                                {addr.invoiceType === 'corporate' && addr.companyName
                                  ? addr.companyName
                                  : addr.fullName}
                              </span>
                              <span
                                className="rounded px-1.5 py-0.5 text-xs"
                                style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
                              >
                                {addr.invoiceType === 'corporate' ? 'Kurumsal' : 'Bireysel'}
                              </span>
                            </div>
                            <p style={{ color: 'var(--color-muted-fg)' }}>
                              {addr.addressLine1}
                              {addr.addressLine2 ? `, ${addr.addressLine2}` : ''}
                            </p>
                            <p style={{ color: 'var(--color-muted-fg)' }}>
                              {[addr.district, '/', addr.city, addr.postalCode].filter(Boolean).join(' ')}
                            </p>
                          </div>
                          {selectedBillingAddressId === addr.id ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4" style={{ color: selectedOptionBorderColor }} />
                          ) : null}
                        </label>
                      ))}
                      <a
                        href="/hesabim/adresler"
                        className="mt-1 inline-flex items-center gap-1.5 text-xs"
                        style={{ color: 'var(--color-accent)' }}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Plus className="h-3 w-3" />
                        Adreslerim&apos;den yönet
                      </a>
                    </div>
                  )
                })()}
              </div>
            )}
          </section>

          <section
            className="rounded-xl border p-6"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <CreditCard className="h-5 w-5" style={{ color: 'var(--color-accent)' }} />
              <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                Ödeme Yöntemi
              </h2>
            </div>

            <div className="space-y-3">
              {cardPaymentsEnabled ? <label
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                style={{
                  borderColor:
                    paymentMethod === 'card' ? selectedOptionBorderColor : 'var(--color-border)',
                }}
              >
                <input
                  type="radio"
                  name="payment"
                  value="card"
                  checked={paymentMethod === 'card'}
                  onChange={() => setPaymentMethod('card')}
                  style={{ accentColor: selectedOptionBorderColor }}
                />
                <CreditCard className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                    Kredi / Banka Kartı
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    Güvenli ödeme - iyzico altyapısı
                  </p>
                </div>
              </label> : (
                <div
                  className="rounded-lg border p-3 text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                >
                  Kartla ödeme yakında iyzico ile açılacaktır. Şimdilik yalnız Havale / EFT ile
                  sipariş verebilirsiniz.
                </div>
              )}

              {cardPaymentsEnabled && paymentMethod === 'card' ? (
                <div
                  className="space-y-3 rounded-lg border p-4"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5" style={{ color: 'var(--color-muted-fg)' }} />
                    <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      Kart bilgileriniz şifreli iletilir, sunucularımızda saklanmaz.
                    </span>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                      Kart Üzerindeki İsim *
                    </label>
                    <input
                      type="text"
                      autoComplete="cc-name"
                      placeholder="Ad Soyad"
                      value={cardForm.cardHolderName}
                      onChange={(event) =>
                        setCardForm((prev) => ({ ...prev, cardHolderName: event.target.value }))
                      }
                      className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                      style={{
                        borderColor: cardErrors.cardHolderName
                          ? 'var(--color-danger)'
                          : 'var(--color-border)',
                        backgroundColor: 'var(--color-bg)',
                        color: 'var(--color-primary)',
                      }}
                    />
                    {cardErrors.cardHolderName ? (
                      <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                        {cardErrors.cardHolderName}
                      </p>
                    ) : null}
                  </div>

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
                      onChange={(event) => {
                        const digits = event.target.value.replace(/\D/g, '').slice(0, 16)
                        const formatted = digits.replace(/(.{4})/g, '$1 ').trim()
                        setCardForm((prev) => ({ ...prev, cardNumber: formatted }))
                      }}
                      className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:ring-2"
                      style={{
                        borderColor: cardErrors.cardNumber
                          ? 'var(--color-danger)'
                          : 'var(--color-border)',
                        backgroundColor: 'var(--color-bg)',
                        color: 'var(--color-primary)',
                      }}
                    />
                    {cardErrors.cardNumber ? (
                      <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                        {cardErrors.cardNumber}
                      </p>
                    ) : null}
                  </div>

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
                        onChange={(event) =>
                          setCardForm((prev) => ({
                            ...prev,
                            expireMonth: event.target.value.replace(/\D/g, '').slice(0, 2),
                          }))
                        }
                        className="w-full rounded-lg border px-3 py-2 text-center text-sm outline-none focus:ring-2"
                        style={{
                          borderColor: cardErrors.expireMonth
                            ? 'var(--color-danger)'
                            : 'var(--color-border)',
                          backgroundColor: 'var(--color-bg)',
                          color: 'var(--color-primary)',
                        }}
                      />
                      {cardErrors.expireMonth ? (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                          {cardErrors.expireMonth}
                        </p>
                      ) : null}
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
                        onChange={(event) =>
                          setCardForm((prev) => ({
                            ...prev,
                            expireYear: event.target.value.replace(/\D/g, '').slice(0, 4),
                          }))
                        }
                        className="w-full rounded-lg border px-3 py-2 text-center text-sm outline-none focus:ring-2"
                        style={{
                          borderColor: cardErrors.expireYear
                            ? 'var(--color-danger)'
                            : 'var(--color-border)',
                          backgroundColor: 'var(--color-bg)',
                          color: 'var(--color-primary)',
                        }}
                      />
                      {cardErrors.expireYear ? (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                          {cardErrors.expireYear}
                        </p>
                      ) : null}
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
                        onChange={(event) =>
                          setCardForm((prev) => ({
                            ...prev,
                            cvc: event.target.value.replace(/\D/g, '').slice(0, 4),
                          }))
                        }
                        className="w-full rounded-lg border px-3 py-2 text-center text-sm outline-none focus:ring-2"
                        style={{
                          borderColor: cardErrors.cvc
                            ? 'var(--color-danger)'
                            : 'var(--color-border)',
                          backgroundColor: 'var(--color-bg)',
                          color: 'var(--color-primary)',
                        }}
                      />
                      {cardErrors.cvc ? (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                          {cardErrors.cvc}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                      TC Kimlik Numarası *
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="12345678901"
                      maxLength={11}
                      value={cardForm.identityNumber}
                      onChange={(event) =>
                        setCardForm((prev) => ({
                          ...prev,
                          identityNumber: event.target.value.replace(/\D/g, '').slice(0, 11),
                        }))
                      }
                      className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:ring-2"
                      style={{
                        borderColor: cardErrors.identityNumber
                          ? 'var(--color-danger)'
                          : 'var(--color-border)',
                        backgroundColor: 'var(--color-bg)',
                        color: 'var(--color-primary)',
                      }}
                    />
                    {cardErrors.identityNumber ? (
                      <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                        {cardErrors.identityNumber}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      iyzico ödeme güvenliği için zorunludur. Sunucularımızda saklanmaz.
                    </p>
                  </div>
                </div>
              ) : null}

              <label
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                style={{
                  borderColor:
                    paymentMethod === 'eft' ? selectedOptionBorderColor : 'var(--color-border)',
                }}
              >
                <input
                  type="radio"
                  name="payment"
                  value="eft"
                  checked={paymentMethod === 'eft'}
                  onChange={() => setPaymentMethod('eft')}
                  style={{ accentColor: selectedOptionBorderColor }}
                />
                <Banknote className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      Havale / EFT
                    </p>
                    {(cartSummary?.eftDiscountRatePercent ?? 0) > 0 ? (
                      <span
                        className="rounded px-1.5 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: '#dcfce7', color: 'var(--color-success)' }}
                      >
                        %{cartSummary!.eftDiscountRatePercent} indirim
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    Sipariş sonrasında banka bilgileri gösterilir
                  </p>
                </div>
              </label>
            </div>
          </section>
        </div>

        <div
          className="h-fit rounded-xl border p-6"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Sipariş Özeti
          </h2>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
              <span>Ürünler</span>
              <span>{formatPrice(grossSubtotal)}</span>
            </div>
            {paymentMethod === 'eft' && eftDiscount > 0 && (cartSummary?.eftDiscountRatePercent ?? 0) > 0 ? (
              <div className="flex justify-between" style={{ color: 'var(--color-success)' }}>
                <span>EFT / Havale indirimi</span>
                <span>-{formatPrice(eftDiscount)}</span>
              </div>
            ) : null}
            {couponDiscount > 0 ? (
              <div className="flex justify-between" style={{ color: 'var(--color-success)' }}>
                <span>Kupon indirimi</span>
                <span>-{formatPrice(couponDiscount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
              <span>Kargo</span>
              <span>{shipping === 0 ? <span style={{ color: 'var(--color-success)' }}>Ücretsiz</span> : formatPrice(shipping)}</span>
            </div>
            {shipping > 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {formatPrice(freeShippingThreshold)} ve üzeri siparişlerde kargo ücretsizdir.
              </p>
            ) : null}
            <Separator />
            <div className="flex justify-between text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
              <span>Toplam</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>

          {(!hasAddress || legalLoading || legalError) ? (
            <div className="mt-5 rounded-lg border p-4 text-xs" style={{ borderColor: 'var(--color-border)' }}>
              {!hasAddress ? (
                <p style={{ color: 'var(--color-muted-fg)' }}>
                  Siparişe özel sözleşmeleri görmek ve onaylamak için önce teslimat adresi seçin.
                </p>
              ) : legalLoading ? (
                <div className="flex items-center gap-2" style={{ color: 'var(--color-muted-fg)' }}>
                  <Spinner className="h-4 w-4" />
                  Seçili adrese göre sözleşmeler hazırlanıyor...
                </div>
              ) : legalError ? (
                <p style={{ color: 'var(--color-danger)' }}>{legalError}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 space-y-3">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-current"
                checked={acceptedMesafeliSatis}
                disabled={!documentsReady}
                onChange={(event) => setAcceptedMesafeliSatis(event.target.checked)}
              />
              <div className="text-xs leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
                <LegalDocumentDialog
                  title="Mesafeli Satış Sözleşmesi"
                  description="Bu metin sipariş anındaki müşteri, teslimat adresi ve ödeme yöntemi bilgilerinize göre oluşturulur."
                  html={legalPreview?.distanceSalesHtml ?? ''}
                  triggerLabel="Mesafeli Satış Sözleşmesi"
                  disabled={!documentsReady}
                  triggerClassName="h-auto px-0 py-0 text-xs font-medium underline underline-offset-2"
                />
                {' '}metnini okudum, kabul ediyorum.
              </div>
            </div>

            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-current"
                checked={acceptedOnBilgilendirme}
                disabled={!documentsReady}
                onChange={(event) => setAcceptedOnBilgilendirme(event.target.checked)}
              />
              <div className="text-xs leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
                <LegalDocumentDialog
                  title="Ön Bilgilendirme Formu"
                  description="Bu metin sipariş öncesi bilgilendirme yükümlülüğü kapsamında seçtiğiniz adres ve ödeme yöntemiyle hazırlanır."
                  html={legalPreview?.preInformationHtml ?? ''}
                  triggerLabel="Ön Bilgilendirme Formu"
                  disabled={!documentsReady}
                  triggerClassName="h-auto px-0 py-0 text-xs font-medium underline underline-offset-2"
                />
                {' '}metnini okudum, kabul ediyorum.
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
            <p className="mb-3 text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
              İnsan doğrulaması
            </p>
            <TurnstileWidget
              action="checkout-submit"
              className="max-w-full"
              onChange={setTurnstileToken}
              siteKey={turnstileSiteKey}
            />
            <p className="mt-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Siparişi onaylamak için bu adım zorunludur.
            </p>
          </div>

          <Button
            className="mt-4 w-full"
            data-testid="checkout-submit"
            size="lg"
            onClick={placeOrder}
            disabled={
              submitting ||
              !documentsReady ||
              !acceptedMesafeliSatis ||
              !acceptedOnBilgilendirme
            }
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Spinner className="h-4 w-4" />
                İşleniyor...
              </span>
            ) : paymentMethod === 'card' ? (
              'Siparişi Onayla ve Öde'
            ) : (
              'Siparişi Onayla ve Havale Bilgilerini Göster'
            )}
          </Button>

          {!documentsReady ? (
            <p className="mt-2 text-center text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Adres seçilip sözleşmeler hazırlanmadan sipariş onaylanamaz.
            </p>
          ) : !acceptedMesafeliSatis || !acceptedOnBilgilendirme ? (
            <p className="mt-2 text-center text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Devam etmek için iki sözleşmeyi de onaylayın.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

