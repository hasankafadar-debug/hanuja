import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

export const metadata: Metadata = { title: 'Hakkımızda', description: 'Hanuja pazaryeri ve işletmeci bilgileri.' }

export default function AboutPage() {
  return <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
    <h1 className="text-3xl font-semibold">Hakkımızda</h1>
    <div className="mt-6 space-y-5 leading-7 text-[var(--color-muted-fg)]">
      <p>Hanuja, bağımsız üretici ve satıcıların ürünlerini müşterilerle buluşturan bir elektronik ticaret pazaryeridir. Platform; ürün keşfi, güvenli ödeme, sipariş takibi, sözleşme ve satış sonrası destek süreçlerini tek yerde sunar.</p>
      <p>Pazaryerinin işletmecisi <strong>{PLATFORM_LEGAL_INFO.companyNameDisplay}</strong>’dir. Merkez adresimiz {PLATFORM_LEGAL_INFO.address}’tir.</p>
      <p>Satış sözleşmesinde her ürünün satıcısı ayrıca gösterilir. Hanuja, pazaryeri hizmet sağlayıcısı olarak ödeme ve sipariş akışını işletir; satıcıların başvuru ve belge kontrollerini gerçekleştirir.</p>
      <p>Sorularınız için <a className="underline" href="/iletisim">iletişim bilgilerimize</a> ulaşabilirsiniz.</p>
    </div>
  </main>
}
