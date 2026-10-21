'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  FileText,
  Lock,
  MapPin,
  Plus,
} from 'lucide-react'
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
  tcNumber?: string | null
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
  previewId?: string
  sourceHash?: string
  distanceSalesHtml: string
  preInformationHtml: string
}

type PaymentMethod = 'card' | 'eft'

interface CheckoutFormSession {
  startKey?: string
  orderId: string
  attemptId: string
  iframeUrl: string
  expiresAt: string
}

type CheckoutPageClientProps = {
  cardPaymentsEnabled: boolean
  turnstileSiteKey?: string | undefined
  /** Ödenmemiş kart siparişini yeniden ödeme (?siparis=) */
  retryOrderId?: string | null
  /** 3DS dönüşündeki hata kodu (?hata=) */
  callbackErrorCode?: string | null
}

interface RetryState {
  orderId: string
  status: string
  payable: boolean
  checking: boolean
  expiresAt: string | null
  totalAmount: string
  grossAmount?: string
  couponDiscountAmount?: string
  shippingAmount?: string
  attemptsLeft: number
  confirmed: boolean
  attemptId: string | null
  attemptStatus: string | null
}

const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  reddedildi:
    'Bankanız ödemeyi onaylamadı. Kart bilgilerinizi kontrol edip farklı bir kartla tekrar deneyebilirsiniz.',
  sure: 'Ödeme oturumunuz sona erdi. Ürünleriniz sepetinizde; tekrar deneyebilirsiniz.',
  dogrulama: 'Ödeme doğrulanamadı. Lütfen tekrar deneyin.',
  sistem:
    'Ödeme sırasında bir hata oluştu. Kartınızdan çekim yapılmışsa sipariş sayfanızda görünecektir.',
}

/** "Ödemeyi tamamla" niyeti başına bir anahtar; ağ tekrarlarında aynı anahtar gönderilir. */
function newStartKey() {
  return `start-${crypto.randomUUID()}`
}

function paymentConfirmedInBrowser() {
  sessionStorage.removeItem('hanuja:checkout-form:start')
  sessionStorage.removeItem('hanuja:checkout-form:source')
  window.dispatchEvent(new CustomEvent('hanuja:cart-changed'))
}

/**
 * Havale/EFT "Siparişi tamamla" niyeti başına bir anahtar. Sunucu aynı anahtarla gelen
 * tekrarda (çift tıklama, yanıtı kaybolan istek) yeni sipariş açmaz, ilkini döndürür.
 */
function newEftOrderKey() {
  return `eft-${crypto.randomUUID()}`
}

function formatMoneyExact(value: string | number) {
  return `${Number(value).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} TL`
}

function formatPrice(value: string | number) {
  const formatted = Number(value).toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return `${formatted} TL`
}

export function CheckoutPageClient({
  cardPaymentsEnabled,
  turnstileSiteKey,
  retryOrderId = null,
  callbackErrorCode = null,
}: CheckoutPageClientProps) {
  const router = useRouter()
  const selectedOptionBorderColor = 'var(--color-success)'

  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    retryOrderId || cardPaymentsEnabled ? 'card' : 'eft',
  )
  const [cartSummary, setCartSummary] = useState<CartSummary | null>(null)
  const [legalPreview, setLegalPreview] = useState<LegalPreview | null>(null)
  const [legalLoading, setLegalLoading] = useState(false)
  const [legalError, setLegalError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(
    callbackErrorCode ? (CALLBACK_ERROR_MESSAGES[callbackErrorCode] ?? null) : null,
  )
  const [retryState, setRetryState] = useState<RetryState | null>(null)
  const retryCannotStart = Boolean(retryOrderId) && (!retryState || !retryState.payable)
  const [checkoutSession, setCheckoutSession] = useState<CheckoutFormSession | null>(null)
  const [acceptedContracts, setAcceptedContracts] = useState(false)
  const [consentWarning, setConsentWarning] = useState(false)
  const [startNonce, setStartNonce] = useState(0)
  const [intentReady, setIntentReady] = useState(false)
  const startKeyRef = useRef<string>('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const scrolledAttemptRef = useRef<string | null>(null)
  const sessionRef = useRef<CheckoutFormSession | null>(null)
  const startInFlightRef = useRef(false)
  const generationRef = useRef(0)
  const pendingAbandonRef = useRef<Promise<void>>(Promise.resolve())

  function invalidateSession() {
    const old = sessionRef.current
    sessionRef.current = null
    setCheckoutSession(null)
    generationRef.current += 1
    if (old) {
      pendingAbandonRef.current = csrfFetch('/api/payment/checkout-form/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: old.attemptId }),
      }).then((res) => {
        if (!res.ok)
          throw new Error('Önceki ödeme oturumu kapatılamadı. Bağlantınızı kontrol edin.')
        setStartNonce((v) => v + 1)
      })
      // Keep the rejection handled until the next start awaits it.
      void pendingAbandonRef.current.catch(() =>
        setError('Önceki ödeme oturumu kapatılamadı. Sayfayı yenileyin.'),
      )
    }
  }
  const eftOrderKeyRef = useRef<string>(newEftOrderKey())
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [useDifferentBilling, setUseDifferentBilling] = useState(false)
  const [selectedBillingAddressId, setSelectedBillingAddressId] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileKey, setTurnstileKey] = useState(0)
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
      const storedStartKey = sessionStorage.getItem('hanuja:checkout-form:start')
      const [cartRes, addrRes, retryRes, savedAttemptRes] = await Promise.all([
        fetch('/api/cart', { cache: 'no-store' }),
        fetch('/api/checkout/addresses', { cache: 'no-store' }),
        retryOrderId
          ? fetch(`/api/payment/orders/${encodeURIComponent(retryOrderId)}`, { cache: 'no-store' })
          : Promise.resolve(null),
        !retryOrderId && storedStartKey
          ? fetch('/api/payment/attempts/' + encodeURIComponent(storedStartKey), {
              cache: 'no-store',
            })
          : Promise.resolve(null),
      ])

      if (cartRes.status === 401 || addrRes.status === 401 || retryRes?.status === 401) {
        router.push('/giris?redirect=/odeme')
        return
      }

      const { data: cart } = await cartRes.json()
      const { data: addrs } = await addrRes.json()

      if (!retryOrderId && cart.cardCheckout?.state === 'checking') {
        router.replace('/odeme?siparis=' + encodeURIComponent(cart.cardCheckout.orderId))
        return
      }

      if (savedAttemptRes?.ok) {
        const { data: saved } = await savedAttemptRes.json()
        if (
          saved.superseded ||
          ['expired', 'voided', 'refunded', 'refunded_by_provider'].includes(saved.status)
        ) {
          startKeyRef.current = newStartKey()
          sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
          sessionStorage.removeItem('hanuja:checkout-form:source')
        }
        if (saved.status === 'succeeded') {
          paymentConfirmedInBrowser()
          router.push('/siparis/' + encodeURIComponent(saved.orderId) + '?yeni=1')
          return
        }
        if (
          !saved.superseded &&
          cart.cardCheckout?.orderId === saved.orderId &&
          ['failed', 'outcome_unknown', 'authorizing', 'fraud_review'].includes(saved.status)
        ) {
          if (saved.status === 'failed') {
            startKeyRef.current = newStartKey()
            sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
          }
          router.replace('/odeme?siparis=' + encodeURIComponent(saved.orderId))
          return
        }
      }

      if (retryRes) {
        if (!retryRes.ok) {
          router.push('/sepet')
          return
        }
        const { data: state } = await retryRes.json()
        if (state.confirmed) {
          paymentConfirmedInBrowser()
          router.replace('/siparis/' + encodeURIComponent(state.orderId) + '?yeni=1')
          return
        }
        if (!state.payable && !state.checking) {
          if (state.attemptId) {
            const closed = await csrfFetch('/api/payment/checkout-form/session', {
              method: 'DELETE', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ attemptId: state.attemptId }),
            })
            if (!closed.ok) throw new Error('Önceki ödeme oturumu kapatılamadı.')
          }
          startKeyRef.current = newStartKey()
          sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
          sessionStorage.removeItem('hanuja:checkout-form:source')
          router.replace('/odeme?hata=sure')
          return
        }
        setRetryState(state as RetryState)
      } else if ((!cart?.itemCount || cart.itemCount === 0) && !sessionRef.current) {
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

      const shippingAddresses = (addrs ?? []).filter(
        (address: Address) => !address.isBillingAddress,
      )
      const defaultAddress =
        shippingAddresses.find((address: Address) => address.isDefault) ?? shippingAddresses[0]
      if (!shippingAddresses.length) setShowAddressForm(true)
      if (defaultAddress) {
        setSelectedAddressId((previous) =>
          shippingAddresses.some((address: Address) => address.id === previous)
            ? previous
            : defaultAddress.id,
        )
      }
    } catch {
      setError('Sayfa yüklenirken hata oluştu.')
    } finally {
      setLoading(false)
    }
  }, [router, retryOrderId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!retryState?.checking) return
    const timer = setInterval(() => void loadData(), 8000)
    return () => clearInterval(timer)
  }, [retryState?.checking, loadData])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadData()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadData])

  useEffect(() => {
    startKeyRef.current = sessionStorage.getItem('hanuja:checkout-form:start') ?? newStartKey()
    sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
  }, [])

  // Invalidate the provider attempt on a real context change, not on a page reload.
  const previousContextRef = useRef<string | null>(null)
  const contextKey = JSON.stringify([
    paymentMethod,
    selectedAddressId,
    selectedBillingAddressId,
    useDifferentBilling,
    cartSummary,
    retryOrderId,
    addresses.filter(
      (address) => address.id === selectedAddressId || address.id === selectedBillingAddressId,
    ),
  ])
  useEffect(() => {
    if (previousContextRef.current === contextKey) return
    const previous = previousContextRef.current
    previousContextRef.current = contextKey
    setAcceptedContracts(false)
    setConsentWarning(false)
    const old = sessionRef.current
    invalidateSession()
    if (previous && (old || startInFlightRef.current)) {
      startKeyRef.current = newStartKey()
      sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
    }
  }, [contextKey])

  // Persist only a random key and server-generated hash; no identity or provider token.
  useEffect(() => {
    if (!legalPreview?.sourceHash) {
      setIntentReady(paymentMethod !== 'card')
      return
    }
    let cancelled = false
    setIntentReady(false)
    void (async () => {
      const storedHash = sessionStorage.getItem('hanuja:checkout-form:source')
      if (storedHash && storedHash !== legalPreview.sourceHash) {
        const res = await fetch(
          '/api/payment/attempts/' + encodeURIComponent(startKeyRef.current),
          { cache: 'no-store' },
        )
        if (res.ok) {
          const { data } = await res.json()
          // Retrying the same order changes its preview hash, not its reservation.
          // Closing it here would cancel the order we are about to retry.
          if (data.orderId !== retryOrderId) {
            const closed = await csrfFetch('/api/payment/checkout-form/session', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ attemptId: data.attemptId }),
            })
            if (!closed.ok) throw new Error('Önceki ödeme oturumu kapatılamadı.')
          }
        }
        if (cancelled) return
        startKeyRef.current = newStartKey()
        sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
      }
      if (cancelled) return
      sessionStorage.setItem('hanuja:checkout-form:source', legalPreview.sourceHash!)
      setIntentReady(true)
    })().catch(() => {
      if (!cancelled) setError('Önceki ödeme oturumu kontrol edilemedi. Sayfayı yenileyin.')
    })
    return () => {
      cancelled = true
    }
  }, [legalPreview?.sourceHash, paymentMethod, retryOrderId])

  useEffect(() => {
    const previewUrl = retryOrderId
      ? '/api/checkout/contracts-preview?paymentMethod=card&orderId=' +
        encodeURIComponent(retryOrderId)
      : selectedAddressId
        ? '/api/checkout/contracts-preview?addressId=' +
          encodeURIComponent(selectedAddressId) +
          '&paymentMethod=' +
          paymentMethod +
          (useDifferentBilling && selectedBillingAddressId
            ? '&billingAddressId=' + encodeURIComponent(selectedBillingAddressId)
            : '')
        : null
    if (!previewUrl) {
      setLegalPreview(null)
      setLegalError(null)
      setLegalLoading(false)
      return
    }

    let cancelled = false

    async function loadLegalPreview(url: string) {
      setLegalLoading(true)
      setLegalError(null)

      try {
        const res = await fetch(url, { cache: 'no-store' })

        if (res.status === 401) {
          router.push('/giris?redirect=/odeme')
          return
        }

        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (body.code === 'CHECKOUT_FORM_CONTEXT_CHANGED' && body.details?.attemptId) {
            const closed = await csrfFetch('/api/payment/checkout-form/session', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ attemptId: body.details.attemptId }),
            })
            if (!closed.ok) throw new Error('Önceki ödeme oturumu kapatılamadı.')
            if (!cancelled) {
              startKeyRef.current = newStartKey()
              sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
              if (retryOrderId) {
                sessionStorage.removeItem('hanuja:checkout-form:source')
                router.replace('/odeme')
                return
              }
              setStartNonce((v) => v + 1)
            }
            return
          }
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

    void loadLegalPreview(previewUrl)

    return () => {
      cancelled = true
    }
  }, [
    paymentMethod,
    router,
    selectedAddressId,
    selectedBillingAddressId,
    useDifferentBilling,
    retryOrderId,
    startNonce,
    contextKey,
  ])

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

  useEffect(() => {
    if (
      paymentMethod !== 'card' ||
      !cardPaymentsEnabled ||
      !intentReady ||
      !acceptedContracts ||
      !legalPreview?.previewId ||
      legalLoading ||
      !turnstileToken ||
      retryCannotStart ||
      (useDifferentBilling && !selectedBillingAddressId) ||
      checkoutSession ||
      startInFlightRef.current
    )
      return
    const generation = generationRef.current
    startInFlightRef.current = true
    setSubmitting(true)
    setError(null)
    const key = startKeyRef.current
    void (async () => {
      try {
        await pendingAbandonRef.current
        if (generation !== generationRef.current) return
        const res = await csrfFetch('/api/payment/checkout-form/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            previewId: legalPreview.previewId,
            startKey: key,
            turnstileToken,
            acceptedDistanceSales: true,
            acceptedPreInformation: true,
          }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.message ?? 'Ödeme alanı açılamadı.')
        const session = body.data as CheckoutFormSession
        if (generation !== generationRef.current) {
          await csrfFetch('/api/payment/checkout-form/session', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attemptId: session.attemptId }),
          })
          return
        }
        if (session.startKey) {
          startKeyRef.current = session.startKey
          sessionStorage.setItem('hanuja:checkout-form:start', session.startKey)
        }
        sessionRef.current = session
        setCheckoutSession(session)
      } catch (err) {
        // A lost response must recover the existing intent, without a new order/key.
        let recovery = await fetch('/api/payment/attempts/' + encodeURIComponent(key), {
          cache: 'no-store',
        }).catch(() => null)
        if (!recovery?.ok)
          recovery = await fetch(
            '/api/payment/checkout-form/session?previewId=' +
              encodeURIComponent(legalPreview.previewId!),
            { cache: 'no-store' },
          ).catch(() => null)
        const state = recovery?.ok ? (await recovery.json()).data : null
        if (generation !== generationRef.current) {
          if (state?.attemptId)
            await csrfFetch('/api/payment/checkout-form/session', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ attemptId: state.attemptId }),
            })
          return
        }
        if (state?.status === 'succeeded') {
          paymentConfirmedInBrowser()
          router.push('/siparis/' + state.orderId + '?yeni=1')
          return
        }
        if (state?.iframeUrl && state.sourceHash === legalPreview.sourceHash) {
          if (state.startKey) {
            startKeyRef.current = state.startKey
            sessionStorage.setItem('hanuja:checkout-form:start', state.startKey)
          }
          sessionRef.current = state
          setCheckoutSession(state)
          return
        }
        if (state?.orderId && ['failed', 'expired', 'authorizing', 'outcome_unknown', 'fraud_review'].includes(state.status)) {
          startKeyRef.current = newStartKey()
          sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
          router.replace('/odeme?siparis=' + encodeURIComponent(state.orderId))
        }
        setError(err instanceof Error ? err.message : 'Ödeme alanı açılamadı.')
        setAcceptedContracts(false)
        setTurnstileToken('')
        setTurnstileKey((v) => v + 1)
      } finally {
        startInFlightRef.current = false
        setSubmitting(false)
      }
    })()
  }, [
    paymentMethod,
    cardPaymentsEnabled,
    intentReady,
    acceptedContracts,
    legalPreview,
    legalLoading,
    turnstileToken,
    checkoutSession,
    router,
    startNonce,
    useDifferentBilling,
    selectedBillingAddressId,
    submitting,
    retryCannotStart,
  ])

  useEffect(() => {
    if (!checkoutSession) return
    let stopped = false
    let polling = false
    const check = async () => {
      if (polling || stopped) return
      polling = true
      try {
        const res = await fetch(
          '/api/payment/attempts/' + encodeURIComponent(startKeyRef.current),
          { cache: 'no-store' },
        )
        if (!res.ok || stopped) return
        const { data } = await res.json()
        if (data.status === 'succeeded') {
          paymentConfirmedInBrowser()
          router.push('/siparis/' + data.orderId + '?yeni=1')
        } else if (['failed', 'expired', 'voided', 'refunded'].includes(data.status)) {
          sessionRef.current = null
          setCheckoutSession(null)
          setAcceptedContracts(false)
          startKeyRef.current = newStartKey()
          sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
          const failed = data.status === 'failed'
          setError(failed ? 'Ödemeniz onaylanmadı. Tekrar deneyebilirsiniz.' : CALLBACK_ERROR_MESSAGES.sure!)
          router.replace('/odeme?siparis=' + encodeURIComponent(data.orderId) + '&hata=' + (failed ? 'reddedildi' : 'sure'))
          setStartNonce((v) => v + 1)
        }
      } catch {
        /* Poll again; an iframe message is never payment evidence. */
      } finally {
        polling = false
      }
    }
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === iframeRef.current?.contentWindow &&
        event.data?.type === 'hanuja:checkout-form-result'
      )
        void check()
    }
    window.addEventListener('message', onMessage)
    const timer = setInterval(() => void check(), 8000)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('message', onMessage)
    }
  }, [checkoutSession, router])

  async function placeOrder() {
    if (!acceptedContracts) {
      setConsentWarning(true)
      return
    }
    if (paymentMethod === 'card') {
      setError(
        !turnstileToken ? 'İnsan doğrulamasını tamamlayın.' : 'Ödeme alanı hazırlanıyor.',
      )
      return
    }
    if (submitting || retryBlocked) return
    if (useDifferentBilling && !selectedBillingAddressId) {
      setError('Fatura adresi seçin.')
      return
    }
    if (!selectedAddressId && !retryOrderId) {
      setError('Lütfen bir teslimat adresi seçin.')
      return
    }

    if (!legalPreview || legalLoading) {
      setError('Siparişe özel sözleşmeler henüz hazır değil. Lütfen biraz sonra tekrar deneyin.')
      return
    }

    if (!turnstileToken) {
      setError('Devam etmeden önce insan doğrulamasını tamamlayın.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await pendingAbandonRef.current
      const res = await csrfFetch('/api/checkout/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addressId: selectedAddressId,
          ...(useDifferentBilling && selectedBillingAddressId
            ? { billingAddressId: selectedBillingAddressId }
            : {}),
          paymentMethod: 'eft',
          // Hata veya kopan bağlantıdan sonra aynı anahtar gider: sipariş açıldıysa ilki döner.
          idempotencyKey: eftOrderKeyRef.current,
          turnstileToken,
          acceptedDistanceSales: true,
          acceptedPreInformation: true,
        }),
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (body.code === 'CHECKOUT_REQUEST_REUSED') {
          // Bu anahtarla farklı bilgilerle sipariş açılmış; sonraki deneme yeni bir istektir.
          eftOrderKeyRef.current = newEftOrderKey()
        }
        setError(body.message ?? 'Sipariş oluşturulamadı.')
        setTurnstileToken('')
        setTurnstileKey((value) => value + 1)
        setSubmitting(false)
        return
      }

      const orderId = body.data.order.id
      router.push(`/siparis/${orderId}?yeni=1&odeme=eft`)
    } catch {
      setError('Sipariş oluşturulurken hata oluştu.')
      setTurnstileToken('')
      setTurnstileKey((value) => value + 1)
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

  const grossSubtotal = Number(
    retryState?.grossAmount ?? cartSummary?.grossSubtotal ?? cartSummary?.subtotal ?? 0,
  )
  const couponDiscount = Number(
    retryState?.couponDiscountAmount ?? cartSummary?.couponDiscount ?? 0,
  )
  const eftDiscount = paymentMethod === 'eft' ? Number(cartSummary?.eftDiscount ?? 0) : 0
  const freeShippingThreshold = Number(cartSummary?.freeShippingThresholdTry ?? 1500)
  const flatShippingFee = Number(cartSummary?.flatShippingFeeTry ?? 99)
  const shipping = Number(
    retryState?.shippingAmount ??
      cartSummary?.shipping ??
      (grossSubtotal >= freeShippingThreshold ? 0 : flatShippingFee),
  )
  const baseTotal =
    paymentMethod === 'eft'
      ? grossSubtotal - couponDiscount - eftDiscount + shipping
      : retryState
        ? Number(retryState.totalAmount)
        : Number(cartSummary?.total ?? grossSubtotal - couponDiscount + shipping)
  const total = baseTotal
  const hasAddress = Boolean(selectedAddressId) || Boolean(retryOrderId)
  const documentsReady = hasAddress && Boolean(legalPreview) && !legalLoading && !legalError
  const retryBlocked = retryCannotStart

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
          style={{ borderColor: 'var(--color-destructive)', color: 'var(--color-destructive)' }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button type="button" className="ml-auto" onClick={() => setError(null)}>
            x
          </button>
        </div>
      ) : null}

      {retryOrderId ? (
        <div
          className="mb-6 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
          data-testid="checkout-retry-banner"
        >
          {!retryState ? null : retryState.checking ? (
            <p>Ödemeniz kontrol ediliyor. Sonuç netleşmeden yeni ödeme başlatılamaz.</p>
          ) : retryState.payable ? (
            <p>
              {retryState.attemptStatus === 'failed' && !checkoutSession
                ? 'Ödemeniz onaylanmadı. Tekrar deneyebilirsiniz.'
                : 'Ödemeniz henüz tamamlanmadı. Ödemeye devam edebilirsiniz.'}
              {retryState.expiresAt
                ? ` ${new Date(retryState.expiresAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} saatine kadar farklı bir kartla tekrar deneyebilirsiniz.`
                : ''}
            </p>
          ) : (
            <p>Bu ödeme oturumu sona erdi.</p>
          )}
          <a className="mt-1 inline-block text-xs underline" href="/sepet">
            Sepete dön
          </a>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {retryOrderId ? null : (
            <>
              <section
                className="rounded-xl border p-6"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                }}
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
                  {addresses
                    .filter((a) => !a.isBillingAddress)
                    .map((address) => (
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
                            {[address.district, '/', address.city, address.postalCode]
                              .filter(Boolean)
                              .join(' ')}
                          </p>
                          <p style={{ color: 'var(--color-muted-fg)' }}>{address.phone}</p>
                        </div>
                        {selectedAddressId === address.id ? (
                          <CheckCircle2
                            className="mt-0.5 h-4 w-4"
                            style={{ color: selectedOptionBorderColor }}
                          />
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
                      {
                        key: 'addressLine1',
                        label: 'Adres *',
                        placeholder: 'Mahalle, sokak, bina no...',
                      },
                      { key: 'district', label: 'İlçe *', placeholder: 'İlçe' },
                      { key: 'city', label: 'Şehir *', placeholder: 'İzmir' },
                      { key: 'postalCode', label: 'Posta Kodu', placeholder: '35000' },
                      { key: 'label', label: 'Etiket', placeholder: 'Ev, İş...' },
                    ].map(({ key, label, placeholder }) => (
                      <div key={key}>
                        <label
                          className="mb-1 block text-xs"
                          style={{ color: 'var(--color-muted-fg)' }}
                        >
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
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                }}
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
                            </a>{' '}
                            sayfasından yeni fatura adresi ekleyebilirsiniz.
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
                                  <span
                                    className="font-medium"
                                    style={{ color: 'var(--color-primary)' }}
                                  >
                                    {addr.invoiceType === 'corporate' && addr.companyName
                                      ? addr.companyName
                                      : addr.fullName}
                                  </span>
                                  <span
                                    className="rounded px-1.5 py-0.5 text-xs"
                                    style={{
                                      backgroundColor: 'var(--color-muted)',
                                      color: 'var(--color-muted-fg)',
                                    }}
                                  >
                                    {addr.invoiceType === 'corporate' ? 'Kurumsal' : 'Bireysel'}
                                  </span>
                                </div>
                                <p style={{ color: 'var(--color-muted-fg)' }}>
                                  {addr.addressLine1}
                                  {addr.addressLine2 ? `, ${addr.addressLine2}` : ''}
                                </p>
                                <p style={{ color: 'var(--color-muted-fg)' }}>
                                  {[addr.district, '/', addr.city, addr.postalCode]
                                    .filter(Boolean)
                                    .join(' ')}
                                </p>
                              </div>
                              {selectedBillingAddressId === addr.id ? (
                                <CheckCircle2
                                  className="mt-0.5 h-4 w-4"
                                  style={{ color: selectedOptionBorderColor }}
                                />
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
            </>
          )}

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
              {cardPaymentsEnabled || retryOrderId ? (
                <label
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
                </label>
              ) : (
                <div
                  className="rounded-lg border p-3 text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                >
                  Ödeme yöntemi Havale/EFT’dir. Sipariş sonrasında banka bilgileri gösterilecektir.
                </div>
              )}

              {paymentMethod === 'card' ? (
                <div
                  className="space-y-3 rounded-lg border p-4"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <p className="flex gap-2 text-sm">
                    <Lock className="h-4 w-4 shrink-0" />
                    Kart bilgilerinizi iyzico’nun güvenli alanında gireceksiniz.
                  </p>
                  <p className="text-xs">
                    Taksit seçimi, taksit farkı ve kesin ödeme toplamı iyzico alanında gösterilir.
                  </p>
                </div>
              ) : null}

              {retryOrderId ? null : (
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
              )}
            </div>
          </section>
        </div>

        <div
          className="flex h-full flex-col rounded-xl border p-6"
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
            {paymentMethod === 'eft' &&
            eftDiscount > 0 &&
            (cartSummary?.eftDiscountRatePercent ?? 0) > 0 ? (
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
              <span>
                {shipping === 0 ? (
                  <span style={{ color: 'var(--color-success)' }}>Ücretsiz</span>
                ) : (
                  formatPrice(shipping)
                )}
              </span>
            </div>
            {shipping > 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {formatPrice(freeShippingThreshold)} ve üzeri siparişlerde kargo ücretsizdir.
              </p>
            ) : null}
            <Separator />
            <div
              className="flex justify-between text-base font-semibold"
              style={{ color: 'var(--color-primary)' }}
            >
              <span>{paymentMethod === 'card' ? 'Peşin Sepet Toplamı' : 'Toplam'}</span>
              <span>{formatMoneyExact(total)}</span>
            </div>
            {paymentMethod === 'card' ? (
              <p className="text-xs">
                Taksit farkı ve kesin ödeme toplamı iyzico alanında gösterilir.
              </p>
            ) : null}
          </div>

          {!hasAddress || legalLoading || legalError ? (
            <div
              className="mt-5 rounded-lg border p-4 text-xs"
              style={{ borderColor: 'var(--color-border)' }}
            >
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
                <p style={{ color: 'var(--color-destructive)' }}>{legalError}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex items-start gap-2">
            <input
              id="checkout-contracts"
              type="checkbox"
              data-testid="checkout-accept-contracts"
              aria-label="Mesafeli Satış Sözleşmesi ve Ön Bilgilendirme Formu’nu kabul ediyorum"
              className="mt-1 h-4 w-4 shrink-0"
              checked={acceptedContracts}
              disabled={!documentsReady}
              onChange={(e) => {
                setAcceptedContracts(e.target.checked)
                setConsentWarning(false)
                if (!e.target.checked) {
                  invalidateSession()
                  startKeyRef.current = newStartKey()
                  sessionStorage.setItem('hanuja:checkout-form:start', startKeyRef.current)
                }
              }}
            />
            <div className="text-xs leading-relaxed">
              <LegalDocumentDialog
                title="Mesafeli Satış Sözleşmesi"
                html={legalPreview?.distanceSalesHtml ?? ''}
                triggerLabel="Mesafeli Satış Sözleşmesi"
                disabled={!documentsReady}
                triggerClassName="h-auto px-0 py-0 text-xs underline"
              />
              {' ve '}
              <LegalDocumentDialog
                title="Ön Bilgilendirme Formu"
                html={legalPreview?.preInformationHtml ?? ''}
                triggerLabel="Ön Bilgilendirme Formu"
                disabled={!documentsReady}
                triggerClassName="h-auto px-0 py-0 text-xs underline"
              />
              <label htmlFor="checkout-contracts">’nu okudum, kabul ediyorum.</label>
            </div>
          </div>
          {consentWarning ? (
            <p role="alert" className="mt-2 text-sm text-red-600">
              Önce sözleşmeleri onaylayın.
            </p>
          ) : null}

          <div className="mt-auto w-full pt-6">
            <div data-testid="checkout-turnstile" className="w-full max-w-full">
              <TurnstileWidget
                key={turnstileKey}
                action="checkout-submit"
                className="w-full max-w-full"
                fitContainer
                onChange={setTurnstileToken}
                siteKey={turnstileSiteKey}
                size="flexible"
              />
            </div>

            {!checkoutSession ? (
              <Button
                className="mt-4 w-full"
                data-testid="checkout-submit"
                size="lg"
                onClick={placeOrder}
                aria-disabled={
                  !acceptedContracts ||
                  !documentsReady ||
                  !turnstileToken ||
                  submitting ||
                  retryBlocked
                }
                style={
                  !acceptedContracts ||
                  !documentsReady ||
                  !turnstileToken ||
                  submitting ||
                  retryBlocked
                    ? { backgroundColor: '#d1d5db', color: '#4b5563', cursor: 'not-allowed' }
                    : undefined
                }
              >
                {submitting
                  ? 'Ödeme alanı hazırlanıyor…'
                  : paymentMethod === 'card'
                    ? 'Öde'
                    : 'Siparişi Tamamla'}
              </Button>
            ) : null}

            <div data-testid="checkout-submit-note" className="mt-2 text-center text-xs">
              {!documentsReady
                ? 'Adres seçilip sözleşmeler hazırlanmadan ödeme başlatılamaz.'
                : !acceptedContracts
                  ? 'Devam etmek için sözleşmeleri onaylayın.'
                  : !turnstileToken
                    ? 'İnsan doğrulamasını tamamlayın.'
                    : paymentMethod === 'eft'
                      ? 'Banka bilgileri sipariş oluşturulduktan sonra gösterilir.'
                      : 'Kart ve taksit bilgileri iyzico’nun güvenli alanında girilir.'}
            </div>
          </div>
        </div>
      </div>
      {checkoutSession && paymentMethod === 'card' && acceptedContracts ? (
        <section className="-mx-4 mt-8 sm:mx-0" aria-label="iyzico güvenli ödeme">
          <iframe
            ref={iframeRef}
            src={checkoutSession.iframeUrl}
            title="iyzico güvenli kart ödemesi"
            className="h-[1200px] w-full scroll-mt-32 border-0 sm:h-[1000px]"
            onLoad={() => {
              if (scrolledAttemptRef.current === checkoutSession.attemptId) return
              scrolledAttemptRef.current = checkoutSession.attemptId
              iframeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            referrerPolicy="no-referrer"
            allow="payment"
          />
        </section>
      ) : null}
    </div>
  )
}
