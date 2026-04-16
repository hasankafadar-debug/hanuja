/**
 * Seller Onboarding — 3-step form.
 *
 * Step 1: Mağaza Bilgileri (store name, slug, description)
 * Step 2: İşletme Bilgileri (company type, tax number, address)
 * Step 3: Banka Bilgileri (IBAN, account holder name)
 *
 * On completion: POST /api/seller/onboarding → creates Seller record,
 * sets user role to "seller", redirects to /panel.
 *
 * Security: This page is only reachable by authenticated users without
 * a seller role (enforced in middleware.ts).
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type CompanyType = 'individual' | 'sole_proprietorship' | 'limited' | 'joint_stock' | 'other'

interface StepMagaza {
  storeName: string
  slug: string
  description: string
  city: string
}

interface StepIsletme {
  companyType: CompanyType
  companyName: string
  taxNumber: string
  taxOffice: string
  address: string
  city: string
  district: string
  postalCode: string
}

interface StepBanka {
  accountHolderName: string
  iban: string
  bankName: string
}

const STEPS = ['Mağaza', 'İşletme', 'Banka'] as const

function SlugInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  function normalize(raw: string) {
    return raw
      .toLowerCase()
      .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
      .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  return (
    <div className="flex rounded-lg border border-neutral-300 overflow-hidden focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/10 transition">
      <span className="px-3 py-2 bg-neutral-50 text-sm text-neutral-400 border-r border-neutral-300 whitespace-nowrap">
        hanuja.com/magaza/
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(normalize(e.target.value))}
        placeholder="magazanim-adi"
        className="flex-1 px-3 py-2 text-sm outline-none bg-white"
        maxLength={60}
      />
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  })

  const [banka, setBanka] = useState<StepBanka>({
    accountHolderName: '',
    iban: '',
    bankName: '',
  })

  function handleMagazaChange(field: keyof StepMagaza, value: string) {
    setMagaza((prev) => {
      const next = { ...prev, [field]: value }
      // Auto-generate slug from storeName if slug hasn't been manually changed
      if (field === 'storeName' && prev.slug === autoSlug(prev.storeName)) {
        next.slug = autoSlug(value)
      }
      return next
    })
  }

  function autoSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
      .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  async function handleSubmit() {
    setError(null)
    setSubmitting(true)

    // Normalize IBAN: remove spaces
    const cleanIban = banka.iban.replace(/\s/g, '').toUpperCase()

    const res = await fetch('/api/seller/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magaza, isletme, banka: { ...banka, iban: cleanIban } }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.message ?? 'Bir hata oluştu. Lütfen tekrar deneyin.')
      setSubmitting(false)
      return
    }

    router.push('/panel?onboarding=success')
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <div className="border-b border-neutral-200 bg-white px-6 py-4">
        <p className="text-sm font-semibold text-neutral-900">Hanuja Satıcı Başvurusu</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-10">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
                i < step
                  ? 'bg-neutral-900 text-white'
                  : i === step
                    ? 'border-2 border-neutral-900 text-neutral-900'
                    : 'border-2 border-neutral-200 text-neutral-400'
              }`}>
                {i < step ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-sm ${i === step ? 'font-medium text-neutral-900' : 'text-neutral-400'}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px ${i < step ? 'bg-neutral-900' : 'bg-neutral-200'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
          {/* ── Step 0: Mağaza Bilgileri ─────────────────────────────────── */}
          {step === 0 && (
            <>
              <h2 className="text-lg font-semibold text-neutral-900 mb-1">Mağaza Bilgileri</h2>
              <p className="text-sm text-neutral-500 mb-6">Mağazanızın müşterilere görünecek bilgilerini girin.</p>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Mağaza Adı <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={magaza.storeName}
                    onChange={(e) => handleMagazaChange('storeName', e.target.value)}
                    maxLength={100}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
                    placeholder="Örn: Atelier Noa"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Mağaza URL'si <span className="text-red-500">*</span>
                  </label>
                  <SlugInput
                    value={magaza.slug}
                    onChange={(v) => setMagaza((p) => ({ ...p, slug: v }))}
                  />
                  <p className="mt-1 text-xs text-neutral-400">
                    Küçük harf, rakam ve tire kullanabilirsiniz. Sonradan değiştirilemez.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Mağaza Tanıtımı <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    value={magaza.description}
                    onChange={(e) => handleMagazaChange('description', e.target.value)}
                    rows={3}
                    maxLength={500}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition resize-none"
                    placeholder="Mağazanızı ve ürünlerinizi kısaca tanıtın…"
                  />
                  <p className="text-right text-xs text-neutral-400 mt-1">{magaza.description.length}/500</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Şehir <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={magaza.city}
                    onChange={(e) => handleMagazaChange('city', e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
                    placeholder="İstanbul"
                  />
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  onClick={() => {
                    if (!magaza.storeName || !magaza.slug || !magaza.description || !magaza.city) {
                      setError('Lütfen tüm alanları doldurun.')
                      return
                    }
                    setError(null)
                    setStep(1)
                  }}
                  className="rounded-lg bg-neutral-900 text-white text-sm font-medium px-6 py-2.5 hover:bg-neutral-700 transition"
                >
                  Devam →
                </button>
              </div>
            </>
          )}

          {/* ── Step 1: İşletme Bilgileri ─────────────────────────────────── */}
          {step === 1 && (
            <>
              <h2 className="text-lg font-semibold text-neutral-900 mb-1">İşletme Bilgileri</h2>
              <p className="text-sm text-neutral-500 mb-6">
                Faturalandırma ve yasal uyum için işletme bilgilerinizi girin.
              </p>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    İşletme Türü <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={isletme.companyType}
                    onChange={(e) => setIsletme((p) => ({ ...p, companyType: e.target.value as CompanyType }))}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition bg-white"
                  >
                    <option value="individual">Şahıs (Bireysel)</option>
                    <option value="sole_proprietorship">Şahıs Şirketi</option>
                    <option value="limited">Limited Şirketi (Ltd. Şti.)</option>
                    <option value="joint_stock">Anonim Şirketi (A.Ş.)</option>
                    <option value="other">Diğer</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Vergi / TC Kimlik No <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={isletme.taxNumber}
                    onChange={(e) => setIsletme((p) => ({ ...p, taxNumber: e.target.value }))}
                    maxLength={11}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
                    placeholder="10 veya 11 hane"
                  />
                </div>

                {isletme.companyType !== 'individual' && (
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Vergi Dairesi <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={isletme.taxOffice}
                      onChange={(e) => setIsletme((p) => ({ ...p, taxOffice: e.target.value }))}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
                      placeholder="Beyoğlu Vergi Dairesi"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Açık Adres <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    value={isletme.address}
                    onChange={(e) => setIsletme((p) => ({ ...p, address: e.target.value }))}
                    rows={2}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition resize-none"
                    placeholder="Mahalle, cadde, sokak, no…"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      Şehir <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={isletme.city}
                      onChange={(e) => setIsletme((p) => ({ ...p, city: e.target.value }))}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">
                      İlçe
                    </label>
                    <input
                      type="text"
                      value={isletme.district}
                      onChange={(e) => setIsletme((p) => ({ ...p, district: e.target.value }))}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-between">
                <button
                  onClick={() => setStep(0)}
                  className="rounded-lg border border-neutral-300 text-neutral-700 text-sm font-medium px-6 py-2.5 hover:bg-neutral-50 transition"
                >
                  ← Geri
                </button>
                <button
                  onClick={() => {
                    if (!isletme.taxNumber || !isletme.address || !isletme.city) {
                      setError('Lütfen zorunlu alanları doldurun.')
                      return
                    }
                    setError(null)
                    setStep(2)
                  }}
                  className="rounded-lg bg-neutral-900 text-white text-sm font-medium px-6 py-2.5 hover:bg-neutral-700 transition"
                >
                  Devam →
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Banka Bilgileri ────────────────────────────────────── */}
          {step === 2 && (
            <>
              <h2 className="text-lg font-semibold text-neutral-900 mb-1">Banka Bilgileri</h2>
              <p className="text-sm text-neutral-500 mb-2">
                Satış bedelinizin aktarılacağı banka hesabı bilgilerini girin.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 mb-6">
                <strong>Önemli:</strong> IBAN bilgileri admin onayından sonra aktif hale gelir.
                İlk ödemeler doğrulama tamamlandıktan sonra yapılacaktır.
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Hesap Sahibi Adı <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={banka.accountHolderName}
                    onChange={(e) => setBanka((p) => ({ ...p, accountHolderName: e.target.value }))}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
                    placeholder="Ad Soyad veya Şirket Adı"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    IBAN <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={banka.iban}
                    onChange={(e) => setBanka((p) => ({ ...p, iban: e.target.value.toUpperCase() }))}
                    maxLength={32}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
                    placeholder="TR00 0000 0000 0000 0000 0000 00"
                  />
                  <p className="mt-1 text-xs text-neutral-400">TR ile başlayan 26 karakter</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Banka Adı <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={banka.bankName}
                    onChange={(e) => setBanka((p) => ({ ...p, bankName: e.target.value }))}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
                    placeholder="Garanti BBVA, İş Bankası…"
                  />
                </div>
              </div>

              {error && (
                <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="mt-8 flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-neutral-300 text-neutral-700 text-sm font-medium px-6 py-2.5 hover:bg-neutral-50 transition"
                >
                  ← Geri
                </button>
                <button
                  onClick={() => {
                    if (!banka.accountHolderName || !banka.iban || !banka.bankName) {
                      setError('Lütfen tüm alanları doldurun.')
                      return
                    }
                    handleSubmit()
                  }}
                  disabled={submitting}
                  className="rounded-lg bg-neutral-900 text-white text-sm font-medium px-6 py-2.5 hover:bg-neutral-700 disabled:opacity-50 transition"
                >
                  {submitting ? 'Kaydediliyor…' : 'Başvuruyu Tamamla'}
                </button>
              </div>
            </>
          )}

          {/* Shared error (step 0 and 1 validation) */}
          {error && step < 2 && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <p className="text-center text-xs text-neutral-400 mt-6">
          Başvurunuz genellikle 1-3 iş günü içinde değerlendirilir.
          Onay sonrası ürün eklemeye başlayabilirsiniz.
        </p>
      </div>
    </div>
  )
}
