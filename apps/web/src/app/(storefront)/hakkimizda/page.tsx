import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

export const metadata: Metadata = { title: 'Hakkımızda', description: 'Hanuja hakkında: özenle seçilmiş tasarım ürünleri ve işletmeci bilgileri.' }

export default function AboutPage() {
  return <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
    <h1 className="text-3xl font-semibold">Hakkımızda</h1>
    <div className="mt-6 space-y-5 leading-7 text-[var(--color-muted-fg)]">
      <p>Hanuja, özenle seçilmiş tasarım ürünlerini müşterileriyle buluşturan bir e-ticaret platformudur. Ürün keşfi, güvenli ödeme, sipariş takibi ve satış sonrası destek süreçlerini tek yerde sunar.</p>
      <p>Hanuja’nın işletmecisi <strong>{PLATFORM_LEGAL_INFO.companyNameDisplay}</strong>’dir. Merkez adresimiz {PLATFORM_LEGAL_INFO.address}’tir.</p>
      <p>Hanuja’da sunulan ürünlerin satıcısı Hanuja’dır: ödemenizi Hanuja alır, faturanızı Hanuja düzenler, iade ve destek taleplerinizi Hanuja yürütür. Ürünler, Hanuja’nın başvuru ve belge kontrolünden geçirdiği tasarımcılar tarafından hazırlanır ve gönderilir.</p>
      <p>Sorularınız için <a className="underline" href="/iletisim">iletişim bilgilerimize</a> ulaşabilirsiniz.</p>
    </div>
  </main>
}
