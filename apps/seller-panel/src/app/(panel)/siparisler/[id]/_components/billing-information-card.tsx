import { FileText } from 'lucide-react'
import { Separator } from '@hanuja/ui'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

/**
 * Satıcı Hanuja modeli: satıcı faturasını müşteriye değil Hanuja'ya keser. Mal doğrudan
 * müşteriye gittiği için irsaliyede Hanuja adına müşteriye teslim ibaresi yer alır.
 */
export default function BillingInformationCard({
  recipientName,
}: {
  recipientName: string | null
}) {
  const rows: Array<[string, string]> = [
    ['Unvan', PLATFORM_LEGAL_INFO.companyLegalName],
    ['Adres', PLATFORM_LEGAL_INFO.address],
    ['Vergi dairesi', PLATFORM_LEGAL_INFO.taxOffice],
    ['Vergi numarası', PLATFORM_LEGAL_INFO.taxNumber],
    ['MERSİS', PLATFORM_LEGAL_INFO.mersis],
  ]
  return (
    <section
      className="rounded-xl border p-5"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="mb-4 flex items-center gap-2">
        <FileText className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
          Fatura Bilgileri
        </h2>
      </div>
      <div className="space-y-4 text-sm">
        <p style={{ color: 'var(--color-muted-fg)' }}>
          Faturayı aşağıdaki bilgilerle Hanuja&apos;ya kesin.
        </p>
        <dl className="space-y-2" style={{ color: 'var(--color-muted-fg)' }}>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="font-medium">{label}</dt>
              <dd style={{ color: 'var(--color-primary)' }}>{value}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <div className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
            İrsaliye açıklaması
          </h3>
          <p
            className="rounded-lg border px-3 py-2"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-primary)',
            }}
          >
            {PLATFORM_LEGAL_INFO.companyLegalName} adına müşteriye teslim edilmek üzere
          </p>
          {recipientName ? (
            <p style={{ color: 'var(--color-muted-fg)' }}>Teslim alacak kişi: {recipientName}</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
