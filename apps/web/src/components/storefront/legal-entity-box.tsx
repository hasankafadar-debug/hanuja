import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

export function LegalEntityBox() {
  const info = PLATFORM_LEGAL_INFO
  return (
    <div
      className="mb-8 rounded-xl border p-5 text-sm leading-relaxed"
      style={{
        backgroundColor: 'var(--color-muted)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-primary)',
      }}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted-fg)' }}>
        Satıcı / İşletme Sahibi Bilgileri
      </p>
      <dl className="grid grid-cols-1 gap-y-1.5 sm:grid-cols-[max-content_1fr] sm:gap-x-6">
        <dt className="font-medium" style={{ color: 'var(--color-muted-fg)' }}>Unvan</dt>
        <dd>{info.companyNameDisplay}</dd>

        <dt className="font-medium" style={{ color: 'var(--color-muted-fg)' }}>Adres</dt>
        <dd>{info.address}</dd>

        <dt className="font-medium" style={{ color: 'var(--color-muted-fg)' }}>Vergi Dairesi / No</dt>
        <dd>{info.taxOffice} / {info.taxNumber}</dd>

        <dt className="font-medium" style={{ color: 'var(--color-muted-fg)' }}>MERSİS No</dt>
        <dd>{info.mersis}</dd>

        <dt className="font-medium" style={{ color: 'var(--color-muted-fg)' }}>E-posta</dt>
        <dd>
          <a href={`mailto:${info.supportEmail}`} className="underline underline-offset-2">
            {info.supportEmail}
          </a>
        </dd>

        <dt className="font-medium" style={{ color: 'var(--color-muted-fg)' }}>Telefon</dt>
        <dd>
          <a href={info.phoneHref} className="underline underline-offset-2">
            {info.phoneDisplay}
          </a>
        </dd>
      </dl>
    </div>
  )
}
