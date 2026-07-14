import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

export const metadata: Metadata = {
  title: 'İletişim',
  description: 'Hanuja müşteri hizmetleri ve iletişim bilgileri.',
  robots: { index: true, follow: true },
}

export default function IletisimPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 text-2xl font-semibold" style={{ color: 'var(--color-primary)' }}>
        İletişim
      </h1>
      <p className="mb-8 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        Sorularınız için aşağıdaki kanallardan bize ulaşabilirsiniz.
      </p>

      <div className="space-y-6">
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
            Şirket Bilgileri
          </h2>
          <dl className="space-y-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            <div className="flex gap-2">
              <dt className="font-medium w-32 shrink-0" style={{ color: 'var(--color-primary)' }}>Ticari Unvan</dt>
              <dd>{PLATFORM_LEGAL_INFO.companyNameDisplay}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium w-32 shrink-0" style={{ color: 'var(--color-primary)' }}>Adres</dt>
              <dd>{PLATFORM_LEGAL_INFO.address}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium w-32 shrink-0" style={{ color: 'var(--color-primary)' }}>Telefon</dt>
              <dd>
                <a href={PLATFORM_LEGAL_INFO.phoneHref} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                  {PLATFORM_LEGAL_INFO.phoneDisplay}
                </a>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium w-32 shrink-0" style={{ color: 'var(--color-primary)' }}>E-posta</dt>
              <dd>
                <a href={`mailto:${PLATFORM_LEGAL_INFO.supportEmail}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                  {PLATFORM_LEGAL_INFO.supportEmail}
                </a>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium w-32 shrink-0" style={{ color: 'var(--color-primary)' }}>KEP</dt>
              <dd className="min-w-0 break-all">{PLATFORM_LEGAL_INFO.kvkkEmail}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium w-32 shrink-0" style={{ color: 'var(--color-primary)' }}>Vergi Dairesi</dt>
              <dd>{PLATFORM_LEGAL_INFO.taxOffice} — Vergi No: {PLATFORM_LEGAL_INFO.taxNumber}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium w-32 shrink-0" style={{ color: 'var(--color-primary)' }}>MERSİS No</dt>
              <dd>{PLATFORM_LEGAL_INFO.mersis}</dd>
            </div>
          </dl>
        </section>

        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
            Müşteri Hizmetleri
          </h2>
          <p className="text-sm mb-3" style={{ color: 'var(--color-muted-fg)' }}>
            Sipariş, iade ve diğer talepleriniz için aşağıdaki e-posta adresini kullanabilirsiniz.
            Hafta içi 09:00–18:00 saatleri arasında yanıt veriyoruz.
          </p>
          <a
            href={`mailto:${PLATFORM_LEGAL_INFO.supportEmail}`}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: 'var(--color-accent-fg, #fff)',
            }}
          >
            {PLATFORM_LEGAL_INFO.supportEmail}
          </a>
        </section>

        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Bilgileriniz 6698 sayılı KVKK kapsamında işlenmektedir.{' '}
          <a href="/kvkk" className="underline" style={{ color: 'var(--color-primary)' }}>
            KVKK Aydınlatma Metni
          </a>
        </p>
      </div>
    </div>
  )
}
