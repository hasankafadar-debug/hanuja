'use client'

import { useRouter } from 'next/navigation'
import { InvoiceFileCard, type ManagedInvoiceFile } from '@hanuja/ui'
import { FileText } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'

interface Props {
  orderId: string
  currentInvoice: ManagedInvoiceFile | null
  firstUploadedAt: string | null
  sellerEditDeadline: string | null
  canEdit: boolean
  approved: boolean
  managementEnabled: boolean
}

/** The seller's invoice to Hanuja (satıcı Hanuja modeli); it is never shown to the customer. */
export default function InvoiceUploadCard({
  orderId,
  currentInvoice,
  approved,
  ...policy
}: Props) {
  const router = useRouter()
  return (
    <section
      className="rounded-xl border p-5"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <FileText
          className="h-4 w-4"
          aria-hidden="true"
          style={{ color: 'var(--color-accent)' }}
        />
        <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
          Hanuja&apos;ya Kestiğiniz Fatura
        </h2>
      </div>
      <p className="mb-4 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        {approved
          ? 'Fatura onaylandı ve artık değiştirilemez. Düzeltme gerekirse Hanuja yönetimiyle iletişime geçin.'
          : 'Bu fatura yalnız Hanuja tarafından görülür; müşteriye gösterilmez.'}
      </p>
      <InvoiceFileCard
        endpoint={`/api/seller/orders/${orderId}/invoice`}
        invoice={currentInvoice}
        request={csrfFetch}
        onChanged={() => router.refresh()}
        canEdit={policy.canEdit}
        firstUploadedAt={policy.firstUploadedAt}
        sellerEditDeadline={policy.sellerEditDeadline}
        allowDelete={policy.managementEnabled && !approved}
      />
    </section>
  )
}
