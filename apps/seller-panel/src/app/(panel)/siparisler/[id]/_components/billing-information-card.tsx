import { FileText } from 'lucide-react'
import { Separator } from '@hanuja/ui'
import InvoiceAliasCard from './invoice-alias-card'

export interface BillingAddress {
  fullName: string
  addressLine1: string
  addressLine2?: string | null
  district: string
  city: string
  postalCode: string
  invoiceType?: 'individual' | 'corporate' | null
  tcNumber?: string | null
  isForeignNational?: boolean
  companyName?: string | null
  taxOffice?: string | null
  taxNumber?: string | null
}

export default function BillingInformationCard({ address, aliasEmail, aliasStatus }: {
  address: BillingAddress | null
  aliasEmail: string | null
  aliasStatus: 'ready' | 'disabled' | 'error'
}) {
  const corporate = address?.invoiceType === 'corporate'
  return (
    <section className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="mb-4 flex items-center gap-2">
        <FileText className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>Fatura Bilgileri</h2>
      </div>
      <div className="space-y-4 text-sm">
        {address ? <>
          <div>
            <p className="font-medium" style={{ color: 'var(--color-primary)' }}>{corporate ? address.companyName || address.fullName : address.fullName}</p>
            <p style={{ color: 'var(--color-muted-fg)' }}>{corporate ? 'Kurumsal fatura' : 'Bireysel fatura'}</p>
          </div>
          <p style={{ color: 'var(--color-muted-fg)' }}>{[
            address.addressLine1, address.addressLine2,
            `${address.district} / ${address.city}`, address.postalCode,
          ].filter(Boolean).join(', ')}</p>
          <dl className="space-y-2" style={{ color: 'var(--color-muted-fg)' }}>
            {corporate ? <>
              <div><dt className="font-medium">Vergi dairesi</dt><dd>{address.taxOffice || 'Kayıtlı değil'}</dd></div>
              <div><dt className="font-medium">Vergi numarası</dt><dd>{address.taxNumber || 'Kayıtlı değil'}</dd></div>
            </> : address.isForeignNational ? (
              <div><dt className="font-medium">Uyruk bilgisi</dt><dd>Yabancı uyruklu</dd></div>
            ) : (
              <div><dt className="font-medium">T.C. kimlik numarası</dt><dd>{address.tcNumber || 'Kayıtlı değil'}</dd></div>
            )}
          </dl>
        </> : <p style={{ color: 'var(--color-muted-fg)' }}>Fatura adresi mevcut değil.</p>}
        <Separator />
        <InvoiceAliasCard aliasEmail={aliasEmail} status={aliasStatus} />
      </div>
    </section>
  )
}
