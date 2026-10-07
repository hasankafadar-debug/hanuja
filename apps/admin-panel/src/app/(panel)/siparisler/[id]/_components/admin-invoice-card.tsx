'use client'

import { useRouter } from 'next/navigation'
import { InvoiceFileCard, type ManagedInvoiceFile } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

interface Props {
  orderId: string
  sellerId: string
  sellerName: string
  invoice: ManagedInvoiceFile | null
  managementEnabled: boolean
}

export function AdminInvoiceCard({
  orderId,
  sellerId,
  sellerName,
  invoice,
  managementEnabled,
}: Props) {
  const router = useRouter()
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <h3
        className="mb-3 text-sm font-semibold"
        style={{ color: 'var(--color-primary)' }}
      >
        {sellerName}
      </h3>
      <InvoiceFileCard
        endpoint={`/api/admin/orders/${orderId}/invoices/${sellerId}`}
        invoice={invoice}
        request={csrfFetch}
        onChanged={() => router.refresh()}
        canEdit
        allowUpload={managementEnabled}
        allowDelete={managementEnabled}
      />
    </div>
  )
}
