'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { TurnstileWidget } from '@hanuja/ui'
import { hasMatchingNormalizedTokens } from '@hanuja/security/turkish-normalize'
import { authClient, useSession } from '@/lib/auth-client'
import { csrfFetch } from '@/lib/csrf-fetch'
import { ApplicationAccountGate } from './application-account-gate'
import {
  type CompanyType,
  getTaxNumberFieldMeta,
  normalizePhone,
  normalizeTaxNumber,
  validateBusinessStep,
  validateContactStep,
} from '@/lib/onboarding'

type StepMagaza = {
  city: string
  description: string
  slug: string
  storeName: string
}

type StepIsletme = {
  address: string
  city: string
  companyName: string
  companyType: CompanyType
  district: string
  mersis: string
  postalCode: string
  taxNumber: string
  taxOffice: string
}

type StepBanka = {
  accountHolderName: string
  bankName: string
  iban: string
}

type SessionUser = {
  email?: string
  emailVerified?: boolean
  phone?: string | null
}

type OnboardingPageClientProps = {
  turnstileSiteKey?: string | undefined
}

const STEPS = ['Magaza', 'Isletme', 'Banka'] as const

function autoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u015f/g, 's')
    .replace(/\u0131/g, 'i')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeIban(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 26)
}

function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, '$1 ').trim()
}

export function OnboardingPageClient({ turnstileSiteKey }: OnboardingPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: sessionData, isPending: sessionLoading } = useSession()
  const verificationJustCompleted = searchParams.get('verified') === '1'

  const sessionUser = (sessionData?.user ?? null) as SessionUser | null
  const email = sessionUser?.email ?? ''
  const emailVerified = Boolean(sessionUser?.emailVerified)

  const [step, setStep] = useState(0)
  const [verificationRefreshPending, setVerificationRefreshPending] = useState(
    verificationJustCompleted,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [phone, setPhone] = useState('')
  const [magaza, setMagaza] = useState<StepMagaza>({
    storeName: '',
    slug: '',
    description: '',
    city: '',
  })
  const [isletme, setIsletme] = useState<StepIsletme>({
    companyType: 'individual',
    companyName: '',
    taxNumber: '',
    taxOffice: '',
    address: '',
    city: '',
    district: '',
    postalCode: '',
    mersis: '',
  })
  const [banka, setBanka] = useState<StepBanka>({
    accountHolderName: '',
    iban: '',
    bankName: '',
  })

  const taxField = getTaxNumberFieldMeta(isletme.companyType)

  useEffect(() => {
    if (!verificationJustCompleted) return

    let active = true

    void authClient
      .getSession({ query: { disableCookieCache: true } })
      .then((result: { data?: { user?: unknown } | null }) => {
        if (!active) return

        if (result?.data?.user) {
          window.location.replace('/basvuru')
          return
        }

        setVerificationRefreshPending(false)
      })
      .catch(() => {
        if (active) setVerificationRefreshPending(false)
      })

    return () => {
      active = false
    }
  }, [verificationJustCompleted])

  useEffect(() => {
    if (sessionUser?.phone && !phone) {
      setPhone(normalizePhone(sessionUser.phone))
    }
  }, [phone, sessionUser?.phone])

  if (sessionLoading || verificationRefreshPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <p role="status" className="text-sm text-neutral-500">Oturum bilgileri yükleniyor...</p>
      </main>
    )
  }

  if (!sessionUser || !emailVerified) {
    return (
      <ApplicationAccountGate
        email={sessionUser?.email}
        turnstileSiteKey={turnstileSiteKey}
        verificationJustCompleted={verificationJustCompleted}
      />
    )
  }

  function handleMagazaChange(field: keyof StepMagaza, value: string) {
    setMagaza((prev) => {
      const next = { ...prev, [field]: value }

      if (field === 'storeName' && (!prev.slug || prev.slug === autoSlug(prev.storeName))) {
        next.slug = autoSlug(value)
      }

      return next
    })
  }

  function goToBusinessStep() {
    if (!magaza.storeName || !magaza.slug || !magaza.description || !magaza.city) {
      setError('Lütfen mağaza bilgilerini eksiksiz doldurun.')
      return
    }

    const contactError = validateContactStep(phone, emailVerified)
    if (contactError) {
      setError(contactError)
      return
    }

    setError(null)
    setStep(1)
  }

  function goToBankStep() {
    const businessError = validateBusinessStep({
      address: isletme.address,
      city: isletme.city,
      companyName: isletme.companyName,
      companyType: isletme.companyType,
      district: isletme.district,
      taxNumber: isletme.taxNumber,
      taxOffice: isletme.taxOffice,
    })

    if (businessError) {
      setError(businessError)
      return
    }

    setError(null)
    setStep(2)
  }

  async function handleSubmit() {
    setError(null)

    const contactError = validateContactStep(phone, emailVerified)
    if (contactError) {
      setError(contactError)
      return
    }

    const businessError = validateBusinessStep({
      address: isletme.address,
      city: isletme.city,
      companyName: isletme.companyName,
      companyType: isletme.companyType,
      district: isletme.district,
      taxNumber: isletme.taxNumber,
      taxOffice: isletme.taxOffice,
    })

    if (businessError) {
      setError(businessError)
      return
    }

    if (!banka.accountHolderName || !banka.iban || !banka.bankName) {
      setError('Lütfen banka bilgilerini eksiksiz doldurun.')
      return
    }

    if (!hasMatchingNormalizedTokens(banka.accountHolderName, isletme.companyName)) {
      setError('IBAN hesap sahibi, şirket veya işletme adı ile aynı olmalı.')
      return
    }

    if (!turnstileToken) {
      setError('Başvuruyu göndermeden önce insan doğrulamasını tamamlayın.')
      return
    }
    setSubmitting(true)

    try {
      const res = await csrfFetch('/api/seller/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          magaza,
          isletme: {
            ...isletme,
            taxNumber: normalizeTaxNumber(isletme.companyType, isletme.taxNumber),
          },
          banka: {
            ...banka,
            iban: normalizeIban(banka.iban),
          },
          phone: normalizePhone(phone),
          turnstileToken,
        }),
      })

      if (!res.ok) {
        const raw = await res.text()
        let message = 'Başvuru gönderilemedi. Lütfen tekrar deneyin.'

        try {
          const body = JSON.parse(raw) as { message?: string; error?: { message?: string } }
          message = body.message ?? body.error?.message ?? message
        } catch {
          if (raw.trim()) {
            message = raw
          }
        }

        setError(message)
        return
      }

      router.push('/basvuru/tesekkur')
    } catch {
      setError('Bağlantı hatası oluştu. Lütfen tekrar deneyin.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="border-b border-neutral-200 bg-white px-6 py-4">
        <p className="text-sm font-semibold text-neutral-900">Hanuja Satıcı Başvurusu</p>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-10 flex items-center gap-2">
          {STEPS.map((label, index) => (
            <div key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                  index < step
                    ? 'bg-neutral-900 text-white'
                    : index === step
                      ? 'border-2 border-neutral-900 text-neutral-900'
                      : 'border-2 border-neutral-200 text-neutral-400'
                }`}
              >
                {index + 1}
              </div>
              <span className={index === step ? 'text-sm font-medium text-neutral-900' : 'text-sm text-neutral-400'}>
                {label}
              </span>
              {index < STEPS.length - 1 ? (
                <div className={`h-px flex-1 ${index < step ? 'bg-neutral-900' : 'bg-neutral-200'}`} />
              ) : null}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          {verificationJustCompleted ? (
            <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              E-posta adresiniz doğrulandı. Başvurunuza devam edebilirsiniz.
            </div>
          ) : null}

          {step === 0 ? (
            <>
              <h2 className="mb-1 text-lg font-semibold text-neutral-900">Mağaza ve İletişim Bilgileri</h2>
              <p className="mb-6 text-sm text-neutral-500">
                Mağazanızın görünecek bilgilerini ve zorunlu iletişim detaylarını girin.
              </p>

              <div className="space-y-5">
                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Mağaza Adı <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={magaza.storeName}
                    onChange={(event) => handleMagazaChange('storeName', event.target.value)}
                    maxLength={100}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder="Örn: Atelier Noa"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Mağaza URL'si <span className="text-red-500">*</span>
                  </label>
                  <div className="flex overflow-hidden rounded-lg border border-neutral-300 transition focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/10">
                    <span className="whitespace-nowrap border-r border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-400">
                      www.hanuja.com.tr/magaza/
                    </span>
                    <input
                      type="text"
                      value={magaza.slug}
                      onChange={(event) =>
                        setMagaza((prev) => ({ ...prev, slug: autoSlug(event.target.value) }))
                      }
                      placeholder="magazam"
                      className="flex-1 px-3 py-2 text-sm outline-none"
                      maxLength={60}
                    />
                  </div>
                  <p className="mt-1 text-xs text-neutral-400">
                    Sadece küçük harf, rakam ve tire kullanabilirsiniz.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Mağaza Tanıtımı <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={magaza.description}
                    onChange={(event) => handleMagazaChange('description', event.target.value)}
                    rows={4}
                    maxLength={500}
                    className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder="Mağazanızı ve ürünlerinizi kısaca tanıtın."
                  />
                  <p className="mt-1 text-right text-xs text-neutral-400">{magaza.description.length}/500</p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Şehir <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={magaza.city}
                    onChange={(event) => handleMagazaChange('city', event.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder="Istanbul"
                  />
                </div>

                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                  <h3 className="mb-4 text-sm font-semibold text-neutral-900">İletişim Bilgileri</h3>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-neutral-700">
                        E-posta <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        readOnly
                        value={sessionLoading ? 'Yükleniyor...' : email}
                        className="w-full rounded-lg border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm text-neutral-600 outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-neutral-700">
                        Telefon <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        inputMode="tel"
                        value={phone}
                        onChange={(event) => setPhone(normalizePhone(event.target.value))}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                        placeholder="05XXXXXXXXX"
                      />
                      <p className="mt-1 text-xs text-neutral-400">
                        Bildirim ve başvuru iletişimleri için geçerli bir Türkiye cep telefonu girin.
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    E-posta adresiniz doğrulanmış durumda.
                  </p>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={goToBusinessStep}
                  className="rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
                >
                  Devam
                </button>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h2 className="mb-1 text-lg font-semibold text-neutral-900">İşletme Bilgileri</h2>
              <p className="mb-6 text-sm text-neutral-500">
                Faturalandırma ve yasal inceleme için işletme bilgilerinizi girin.
              </p>

              <div className="space-y-5">
                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    İşletme Türü <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={isletme.companyType}
                    onChange={(event) =>
                      setIsletme((prev) => ({
                        ...prev,
                        companyType: event.target.value as CompanyType,
                        taxNumber: normalizeTaxNumber(event.target.value as CompanyType, prev.taxNumber),
                      }))
                    }
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                  >
                    <option value="individual">Şahıs (Bireysel)</option>
                    <option value="sole_proprietorship">Şahıs Şirketi</option>
                    <option value="limited">Limited Sirketi</option>
                    <option value="joint_stock">Anonim Sirketi</option>
                    <option value="other">Diğer</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    {taxField.label} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={isletme.taxNumber}
                    onChange={(event) =>
                      setIsletme((prev) => ({
                        ...prev,
                        taxNumber: normalizeTaxNumber(prev.companyType, event.target.value),
                      }))
                    }
                    maxLength={taxField.maxLength}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder={taxField.placeholder}
                  />
                  <p className="mt-1 text-xs text-neutral-400">{taxField.helperText}</p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Ticari Ünvan <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={isletme.companyName}
                    onChange={(event) => setIsletme((prev) => ({ ...prev, companyName: event.target.value }))}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder="Şirket veya işletme ünvanı"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Vergi Dairesi <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={isletme.taxOffice}
                    onChange={(event) => setIsletme((prev) => ({ ...prev, taxOffice: event.target.value }))}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder="Bağlı olduğunuz vergi dairesi"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Açık Adres <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={isletme.address}
                    onChange={(event) => setIsletme((prev) => ({ ...prev, address: event.target.value }))}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder="Mahalle, cadde, sokak, bina no"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-700">
                      Şehir <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={isletme.city}
                      onChange={(event) => setIsletme((prev) => ({ ...prev, city: event.target.value }))}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-700">
                      İlçe <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={isletme.district}
                      onChange={(event) => setIsletme((prev) => ({ ...prev, district: event.target.value }))}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-700">Posta Kodu</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={isletme.postalCode}
                      onChange={(event) =>
                        setIsletme((prev) => ({
                          ...prev,
                          postalCode: event.target.value.replace(/\D/g, '').slice(0, 5),
                        }))
                      }
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                      placeholder="34000"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-700">MERSIS</label>
                    <input
                      type="text"
                      value={isletme.mersis}
                      onChange={(event) => setIsletme((prev) => ({ ...prev, mersis: event.target.value }))}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                      placeholder="Varsa MERSİS numarası"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="rounded-lg border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
                >
                  Geri
                </button>
                <button
                  type="button"
                  onClick={goToBankStep}
                  className="rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700"
                >
                  Devam
                </button>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h2 className="mb-1 text-lg font-semibold text-neutral-900">Banka Bilgileri</h2>
              <p className="mb-2 text-sm text-neutral-500">
                Ödemelerin aktarılacağı banka hesabını girin. Admin onayından sonra aktifleştirilir.
              </p>
              <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                IBAN hesap sahibi, başvurduğunuz şirket veya işletme adı ile uyumlu olmalı.
              </div>

              <div className="space-y-5">
                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Hesap Sahibi Adı <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={banka.accountHolderName}
                    onChange={(event) =>
                      setBanka((prev) => ({ ...prev, accountHolderName: event.target.value }))
                    }
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder="Ad Soyad veya Şirket Adı"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    IBAN <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formatIban(banka.iban)}
                    onChange={(event) =>
                      setBanka((prev) => ({ ...prev, iban: normalizeIban(event.target.value) }))
                    }
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder="TR00 0000 0000 0000 0000 0000 00"
                  />
                  <p className="mt-1 text-xs text-neutral-400">TR ile başlayan 26 karakterlik IBAN girin.</p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">
                    Banka Adı <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={banka.bankName}
                    onChange={(event) => setBanka((prev) => ({ ...prev, bankName: event.target.value }))}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                    placeholder="Garanti BBVA, İş Bankası"
                  />
                </div>

                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="mb-3 text-sm font-medium text-neutral-900">İnsan doğrulaması</p>
                  <TurnstileWidget
                    action="seller-onboarding"
                    onChange={setTurnstileToken}
                    siteKey={turnstileSiteKey}
                    className="max-w-full"
                  />
                  <p className="mt-2 text-xs text-neutral-500">
                    Başvuruyu göndermeden önce bu doğrulama zorunludur.
                  </p>
                </div>
              </div>

              <div className="mt-8 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
                >
                  Geri
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || sessionLoading}
                  className="rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
                >
                  {submitting ? 'Başvuru gönderiliyor...' : 'Başvuruyu Tamamla'}
                </button>
              </div>
            </>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          ) : null}
        </div>

        <p className="mt-6 text-center text-xs text-neutral-400">
          Başvurular genellikle 1-3 iş günü içinde incelenir. Onay sonrası ürün eklemeye başlayabilirsiniz.
        </p>
      </div>
    </div>
  )
}
