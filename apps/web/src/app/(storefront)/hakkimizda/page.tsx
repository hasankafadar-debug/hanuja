import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'
import { buildPublicPageMetadata } from '@hanuja/seo'
import Link from 'next/link'

export const metadata: Metadata = buildPublicPageMetadata({
  path: '/hakkimizda',
  title: 'Hakkımızda',
  description: 'Hanuja hakkında: özenle seçilmiş tasarım ürünleri ve işletmeci bilgileri.',
})

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold">Hakkımızda</h1>
      <div className="mt-6 space-y-5 leading-7 text-[var(--color-muted-fg)]">
        <p>
          Hanuja, özenle seçilmiş tasarım ürünlerini müşterileriyle buluşturan bir e-ticaret
          platformudur. Ürün keşfi, güvenli ödeme, sipariş takibi ve satış sonrası destek
          süreçlerini tek yerde sunar.
        </p>
        <p>
          Hanuja’nın işletmecisi <strong>{PLATFORM_LEGAL_INFO.companyNameDisplay}</strong>’dir.
          Merkez adresimiz {PLATFORM_LEGAL_INFO.address}’tir.
        </p>
        <p>
          Hanuja’da sunulan ürünlerin satıcısı Hanuja’dır: ödemenizi Hanuja alır, faturanızı Hanuja
          düzenler, iade ve destek taleplerinizi Hanuja yürütür. Ürünler, Hanuja’nın başvuru ve
          belge kontrolünden geçirdiği tasarımcılar tarafından hazırlanır ve gönderilir.
        </p>
        <h2 className="text-xl font-medium text-[var(--color-primary)]">Tasarımcılar ve ürünler</h2>
        <p>
          <Link className="underline" href="/magaza">
            Tasarımcılarımızı
          </Link>{' '}
          tanıyabilir,{' '}
          <Link className="underline" href="/blog">
            Hanuja Blog
          </Link>{' '}
          üzerinden yaşam alanlarınız için fikirler bulabilirsiniz.
        </p>
        <h2 className="text-xl font-medium text-[var(--color-primary)]">İletişim ve destek</h2>
        <p>
          Sorularınız için{' '}
          <Link className="underline" href="/iletisim">
            iletişim bilgilerimize
          </Link>{' '}
          ulaşabilirsiniz.
        </p>
      </div>
    </main>
  )
}
