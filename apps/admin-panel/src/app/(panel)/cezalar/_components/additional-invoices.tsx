import Link from 'next/link'
import type { Prisma, PrismaClient } from '@prisma/client'
import { PageHeader } from '@hanuja/ui'
import { IssueSellerInvoiceButton } from '@/components/issue-seller-invoice-button'
import { EditInvoiceDialog } from '@/components/edit-invoice-dialog'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { buildDateRange, getPagination, type AdminListParams } from '@/lib/admin-list-params'

export type InvoiceTab = 'unbilled' | 'billed' | 'waived' | 'additional'
export type InvoiceSellerOption = { id: string; name: string }

function formatInvoiceAmount(value: number) {
  return `${value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`
}

export function InvoiceTabs({ current, params }: { current: InvoiceTab; params: AdminListParams }) {
  return (
    <div className="flex flex-wrap gap-2">
      {[
        { key: 'unbilled', label: 'Faturalandırılmamış' },
        { key: 'billed', label: 'Faturalandırılmış' },
        { key: 'waived', label: 'Muaflar' },
        { key: 'additional', label: 'Ek Faturalar' },
      ].map((tab) => {
        const query = new URLSearchParams({ tab: tab.key })
        if (params.q) query.set('q', params.q)
        if (params.seller) query.set('seller', params.seller)
        if (params.from) query.set('from', params.from)
        if (params.to) query.set('to', params.to)
        if (params.status.length && tab.key !== 'additional') query.set('status', params.status.join(','))
        if (params.pageSize !== 20) query.set('pageSize', String(params.pageSize))
        const active = current === tab.key
        return <Link key={tab.key} href={`/cezalar?${query}`} aria-current={active ? 'page' : undefined}
          className="rounded-full border px-4 py-2 text-sm font-medium transition-colors"
          style={{ borderColor: active ? 'var(--color-accent)' : 'var(--color-border)', backgroundColor: active ? 'var(--color-muted)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-muted-fg)' }}>
          {tab.label}
        </Link>
      })}
    </div>
  )
}

export async function AdditionalInvoices({ prisma, params, sellers }: {
  prisma: PrismaClient; params: AdminListParams; sellers: InvoiceSellerOption[]
}) {
  const { from, to } = buildDateRange(params)
  const where: Prisma.SellerInvoiceWhereInput = {
    type: 'additional',
    ...(params.seller ? { sellerId: params.seller } : {}),
    ...(from || to ? { invoiceDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(params.q ? { OR: [
      { invoiceNumber: { contains: params.q, mode: 'insensitive' } },
      { description: { contains: params.q, mode: 'insensitive' } },
      { seller: { displayName: { contains: params.q, mode: 'insensitive' } } },
    ] } : {}),
  }
  const [rows, count] = await Promise.all([
    prisma.sellerInvoice.findMany({ where, ...getPagination(params), orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
      include: { seller: { select: { displayName: true } } } }),
    prisma.sellerInvoice.count({ where }),
  ])
  const entries = rows.length ? await prisma.sellerLedgerEntry.findMany({
    where: { referenceType: 'seller_invoice', referenceId: { in: rows.map((row) => row.id) } },
    select: { referenceId: true, debtOffsets: { select: { amount: true } } },
  }) : []
  const offsets = new Map<string, number>()
  for (const entry of entries) offsets.set(entry.referenceId,
    (offsets.get(entry.referenceId) ?? 0) + entry.debtOffsets.reduce((sum, item) => sum + Number(item.amount), 0))

  return (
    <div className="space-y-6" data-testid="admin-additional-invoices-page">
      <PageHeader title="Cezalar ve Ek Faturalar" description={`${count} ek fatura kaydı`}
        actions={<IssueSellerInvoiceButton type="additional" sellers={sellers} defaultDescription="" defaultAmount="" buttonLabel="Fatura Ekle" />} />
      <InvoiceTabs current="additional" params={params} />
      <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        Kaydettiğiniz fatura toplamı tasarımcı ekstresine borç olarak işlenir. Borç hakedişlerden düşülür; kalan tutar sonraki ödemelere taşınır.
      </p>
      <AdminListControls searchValue={params.q} searchPlaceholder="Fatura, açıklama veya tasarımcı ara" sellerValue={params.seller}
        sellerPlaceholder="Tasarımcı ID" fromValue={params.from} toValue={params.to} pageSize={params.pageSize} showSellerFilter />
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        {rows.length === 0 ? <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>Ek fatura kaydı yok.</p> : (
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}><tr>
              {['Fatura No', 'Tasarımcı', 'Fatura Tarihi', 'Açıklama', 'Tutar (KDV dahil)', 'Durum', ''].map((heading) =>
                <th key={heading} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: 'var(--color-muted-fg)' }}>{heading}</th>)}
            </tr></thead>
            <tbody>{rows.map((invoice) => {
              const deducted = offsets.get(invoice.id) ?? 0
              return <tr key={invoice.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="whitespace-nowrap px-4 py-3 font-medium">{invoice.invoiceNumber}</td>
                <td className="px-4 py-3"><Link className="hover:underline" href={`/saticilar/${invoice.sellerId}`}>{invoice.seller.displayName}</Link></td>
                <td className="whitespace-nowrap px-4 py-3">{invoice.invoiceDate.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}</td>
                <td className="min-w-48 px-4 py-3">{invoice.description}</td>
                <td className="whitespace-nowrap px-4 py-3">{formatInvoiceAmount(Number(invoice.grossInvoiceAmount))}</td>
                <td className="min-w-40 px-4 py-3">
                  {deducted >= Number(invoice.grossInvoiceAmount) ? 'Mahsup edildi' : deducted > 0 ? 'Kısmen mahsup edildi' : 'Hakedişten düşülecek'}
                  {deducted > 0 ? <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>Kesilen: {formatInvoiceAmount(deducted)}</p> : null}
                </td>
                <td className="px-4 py-3"><EditInvoiceDialog invoiceId={invoice.id} invoiceNumber={invoice.invoiceNumber}
                  invoiceDate={invoice.invoiceDate.toISOString()} invoiceCategory={invoice.invoiceCategory} description={invoice.description}
                  grossInvoiceAmount={invoice.grossInvoiceAmount.toFixed(2)} type="additional" disabled={deducted > 0 || Boolean(invoice.payoutId)} /></td>
              </tr>
            })}</tbody>
          </table>
        )}
      </div>
      <div className="flex justify-end"><UrlPagination page={params.page} totalPages={Math.max(1, Math.ceil(count / params.pageSize))} /></div>
    </div>
  )
}
