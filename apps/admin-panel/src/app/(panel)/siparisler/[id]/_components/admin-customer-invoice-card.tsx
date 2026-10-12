'use client'

import { useRouter } from 'next/navigation'
import { InvoiceFileCard, type ManagedInvoiceFile } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

/**
 * Hanuja's sales invoice to the customer (satıcı Hanuja modeli): issued manually in Uyumsoft
 * within 7 days of shipment, then uploaded here. The customer sees it under "Faturalarım".
 */
export function AdminCustomerInvoiceCard({
  orderId,
  invoice,
  deadline,
}: {
  orderId: string
  invoice: ManagedInvoiceFile | null
  deadline: string | null
}) {
  const router = useRouter()
  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          Müşteri faturası (Hanuja)
        </h3>
        {!invoice && deadline ? (
          <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Son gün: {new Date(deadline).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}
          </span>
        ) : null}
      </div>
      <InvoiceFileCard
        endpoint={`/api/admin/orders/${orderId}/customer-invoice`}
        invoice={invoice}
        request={csrfFetch}
        onChanged={() => router.refresh()}
        canEdit
        emptyMessage="Müşteri faturası henüz yüklenmedi."
      />
    </div>
  )
}
