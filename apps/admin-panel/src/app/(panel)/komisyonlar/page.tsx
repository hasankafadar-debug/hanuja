import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { UrlPagination } from '@/components/url-pagination'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { EditInvoiceDialog } from '@/components/edit-invoice-dialog'
import { InvoiceRowAction, ExemptRowAction } from './_components/row-actions'
import { formatMoney } from '@hanuja/security'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Komisyon Yonetimi' }

type TabKey = 'unbilled' | 'billed' | 'exempt'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'unbilled', label: 'Faturalandirilmamis' },
  { key: 'billed', label: 'Faturalandirilmis' },
  { key: 'exempt', label: 'Muaf' },
]

function getActiveTab(searchParams?: Record<string, string | string[] | undefined>): TabKey {
  const raw = searchParams?.tab
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'billed' || value === 'exempt' ? value : 'unbilled'
}

function getPage(searchParams?: Record<string, string | string[] | undefined>): number {
  const raw = searchParams?.page
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function toNum(v: { toNumber(): number } | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'number' ? v : v.toNumber()
}

const PAGE_SIZE = 30
const VAT_RATE = 0.2

export default async function KomisyonlarPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await getAdminSession()
  const resolved = searchParams ? await searchParams : undefined
  const tab = getActiveTab(resolved)
  const page = getPage(resolved)
  const skip = (page - 1) * PAGE_SIZE

  const prisma = createPrismaForRoute()

  return (
    <div className="space-y-6">
      <PageHeader title="Komisyon Yonetimi" description="Siparis bazli komisyon faturalari, muafiyetler ve gecmis faturalar" />

      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map((tabItem) => (
          <Link
            key={tabItem.key}
            href={`?tab=${tabItem.key}`}
            className="rounded-t-md px-4 py-2 text-sm font-medium"
            style={{
              backgroundColor: tab === tabItem.key ? 'var(--color-surface)' : 'transparent',
              color: tab === tabItem.key ? 'var(--color-primary)' : 'var(--color-muted-fg)',
              borderBottom: tab === tabItem.key ? '2px solid var(--color-primary)' : '2px solid transparent',
            }}
          >
            {tabItem.label}
          </Link>
        ))}
      </div>

      {tab === 'unbilled' ? (
        <UnbilledTab prisma={prisma} skip={skip} take={PAGE_SIZE} page={page} />
      ) : tab === 'billed' ? (
        <BilledTab prisma={prisma} skip={skip} take={PAGE_SIZE} page={page} />
      ) : (
        <ExemptTab prisma={prisma} skip={skip} take={PAGE_SIZE} page={page} />
      )}
    </div>
  )
}

async function UnbilledTab({
  prisma,
  skip,
  take,
  page,
}: {
  prisma: ReturnType<typeof createPrismaForRoute>
  skip: number
  take: number
  page: number
}) {
  const where = {
    commissionInvoiceId: null,
    commissionExemptedAt: null,
    order: { deliveryConfirmedAt: { not: null } },
  }

  const [lines, total] = await Promise.all([
    prisma.orderLine.findMany({
      where,
      orderBy: [{ order: { deliveryConfirmedAt: 'desc' } }, { createdAt: 'desc' }],
      skip,
      take,
      select: {
        id: true,
        productName: true,
        variantName: true,
        quantity: true,
        totalPrice: true,
        commissionRate: true,
        seller: { select: { id: true, displayName: true } },
        order: { select: { id: true, publicNumber: true } },
      },
    }),
    prisma.orderLine.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / take))

  return (
    <>
      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {lines.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Faturalandirilmamis komisyon satiri yok.
          </p>
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Siparis', 'Satici', 'Urun', 'Adet', 'KDV Dahil Satis', 'Komisyon Orani', 'Komisyon Net', 'KDV (%20)', 'KDV Dahil', 'Aksiyon'].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const totalPrice = toNum(line.totalPrice)
                const commissionRate = toNum(line.commissionRate)
                const commissionNet = totalPrice * commissionRate
                const vatAmount = commissionNet * VAT_RATE
                const grossAmount = commissionNet + vatAmount

                return (
                  <tr key={line.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--color-primary)' }}>
                      <Link href={`/siparisler/${line.order.id}`} className="hover:underline">
                        {formatOrderDisplayNumber(line.order.publicNumber, line.order.id)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {line.seller ? (
                        <Link href={`/saticilar/${line.seller.id}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                          {line.seller.displayName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-primary)' }}>
                      {line.productName}
                      {line.variantName ? (
                        <span className="ml-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                          ({line.variantName})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{line.quantity}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(totalPrice)}</td>
                    <td className="px-4 py-3 tabular-nums">%{(commissionRate * 100).toFixed(2)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(commissionNet)}</td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: 'var(--color-muted-fg)' }}>
                      {formatMoney(vatAmount)}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: 'var(--color-primary)' }}>
                      {formatMoney(grossAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <InvoiceRowAction
                          orderLineId={line.id}
                          sellerId={line.seller?.id ?? ''}
                          orderId={line.order.id}
                          commissionNet={commissionNet}
                          orderPublicNumber={line.order.publicNumber}
                        />
                        <ExemptRowAction orderLineId={line.id} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex justify-end">
        <UrlPagination page={page} totalPages={totalPages} />
      </div>
    </>
  )
}

async function BilledTab({
  prisma,
  skip,
  take,
  page,
}: {
  prisma: ReturnType<typeof createPrismaForRoute>
  skip: number
  take: number
  page: number
}) {
  const where = { type: 'commission' as const }
  const [rows, total] = await Promise.all([
    prisma.sellerInvoice.findMany({
      where,
      orderBy: { invoiceDate: 'desc' },
      skip,
      take,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        invoiceCategory: true,
        description: true,
        amount: true,
        vatRate: true,
        vatAmount: true,
        grossInvoiceAmount: true,
        payoutId: true,
        seller: { select: { id: true, displayName: true } },
        sourceOrder: { select: { id: true, publicNumber: true } },
        createdByAdmin: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.sellerInvoice.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / take))

  return (
    <>
      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Faturalandirilmis komisyon kaydi yok.
          </p>
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Fatura No', 'Tarih', 'Siparis', 'Satici', 'Net Tutar', 'KDV', 'KDV Dahil', 'Olusturan', ''].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice) => {
                const net = toNum(invoice.amount)
                const vat = toNum(invoice.vatAmount)
                const gross = toNum(invoice.grossInvoiceAmount)
                const vatPct = Math.round(toNum(invoice.vatRate) * 100)

                return (
                  <tr key={invoice.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      {invoice.invoiceNumber}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {new Date(invoice.invoiceDate).toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {invoice.sourceOrder ? (
                        <Link href={`/siparisler/${invoice.sourceOrder.id}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                          {formatOrderDisplayNumber(invoice.sourceOrder.publicNumber, invoice.sourceOrder.id)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {invoice.seller ? (
                        <Link href={`/saticilar/${invoice.seller.id}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                          {invoice.seller.displayName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums">{formatMoney(net)}</td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: 'var(--color-muted-fg)' }}>
                      {vatPct > 0 ? `${formatMoney(vat)} (%${vatPct})` : '—'}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: 'var(--color-primary)' }}>
                      {formatMoney(gross)}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {invoice.createdByAdmin?.name ?? invoice.createdByAdmin?.email?.split('@')[0] ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {!invoice.payoutId ? (
                        <EditInvoiceDialog
                          invoiceId={invoice.id}
                          invoiceNumber={invoice.invoiceNumber}
                          invoiceDate={invoice.invoiceDate.toISOString()}
                          invoiceCategory={invoice.invoiceCategory}
                          description={invoice.description}
                          grossInvoiceAmount={gross.toFixed(2)}
                          type="commission"
                        />
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex justify-end">
        <UrlPagination page={page} totalPages={totalPages} />
      </div>
    </>
  )
}

async function ExemptTab({
  prisma,
  skip,
  take,
  page,
}: {
  prisma: ReturnType<typeof createPrismaForRoute>
  skip: number
  take: number
  page: number
}) {
  const where = {
    commissionExemptedAt: { not: null },
    commissionInvoiceId: null,
  }
  const [lines, total] = await Promise.all([
    prisma.orderLine.findMany({
      where,
      orderBy: { commissionExemptedAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        productName: true,
        totalPrice: true,
        commissionExemptedAt: true,
        commissionExemptedReason: true,
        seller: { select: { id: true, displayName: true } },
        order: { select: { id: true, publicNumber: true } },
      },
    }),
    prisma.orderLine.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / take))

  return (
    <>
      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {lines.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Komisyon muafiyeti olan satir yok.
          </p>
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Siparis', 'Satici', 'Urun', 'KDV Dahil Satis', 'Muafiyet Tarihi', 'Muafiyet Sebebi'].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--color-primary)' }}>
                    <Link href={`/siparisler/${line.order.id}`} className="hover:underline">
                      {formatOrderDisplayNumber(line.order.publicNumber, line.order.id)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {line.seller ? (
                      <Link href={`/saticilar/${line.seller.id}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                        {line.seller.displayName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">{line.productName}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMoney(toNum(line.totalPrice))}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {line.commissionExemptedAt
                      ? new Date(line.commissionExemptedAt).toLocaleDateString('tr-TR', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 max-w-md whitespace-normal" style={{ color: 'var(--color-muted-fg)' }}>
                    {line.commissionExemptedReason ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex justify-end">
        <UrlPagination page={page} totalPages={totalPages} />
      </div>
    </>
  )
}
