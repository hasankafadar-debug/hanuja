import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createProductQuestionService } from '@hanuja/api/services/product-question.service'
import { UrlPagination } from '@/components/url-pagination'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Müşteri Soruları',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 30

const FILTER_TABS = [
  { value: 'all', label: 'Tümü' },
  { value: 'waiting_for_seller', label: 'Satıcı yanıtı bekleniyor' },
  { value: 'waiting_for_customer', label: 'Yanıtlandı' },
] as const

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  searchParams: Promise<{ durum?: string; page?: string; satici?: string }>
}

// List view shows metadata and a short preview only; opening a conversation is audited.
export default async function AdminProductQuestionsPage({ searchParams }: Props) {
  await getAdminSession()
  const { durum, page: rawPage, satici } = await searchParams
  const status =
    durum === 'waiting_for_seller' || durum === 'waiting_for_customer' ? durum : undefined
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1)

  const { items, total } = await createProductQuestionService({
    prisma: createPrismaForRoute(),
  }).listForAdmin({
    ...(status ? { status } : {}),
    ...(satici ? { sellerId: satici } : {}),
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Müşteri Soruları"
        description="Müşteri ile satıcı arasındaki özel ürün konuşmaları. Salt okunurdur; her görüntüleme denetim günlüğüne yazılır."
      />

      <div className="flex flex-wrap gap-2">
        {FILTER_TABS.map((tab) => {
          const active = (status ?? 'all') === tab.value
          const href = tab.value === 'all' ? '/musteri-sorulari' : `/musteri-sorulari?durum=${tab.value}`
          return (
            <Link
              key={tab.value}
              href={href}
              className="rounded-full border px-3 py-1.5 text-sm font-medium"
              style={{
                borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                backgroundColor: active ? 'var(--color-primary)' : 'var(--color-surface)',
                color: active ? 'var(--color-primary-fg, #fff)' : 'var(--color-muted-fg)',
              }}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}>
              <th className="px-4 py-3">Ürün</th>
              <th className="px-4 py-3">Satıcı</th>
              <th className="px-4 py-3">Müşteri</th>
              <th className="px-4 py-3">Sipariş</th>
              <th className="px-4 py-3">Durum</th>
              <th className="px-4 py-3">Son mesaj</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center" style={{ color: 'var(--color-muted-fg)' }}>
                  Kayıt yok.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-3">
                    {/* No prefetch: opening a conversation writes an audit entry. */}
                    <Link href={`/musteri-sorulari/${item.id}`} prefetch={false} className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                      {item.productName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{item.sellerName}</td>
                  <td className="px-4 py-3">{item.counterpartName}</td>
                  <td className="px-4 py-3">{item.orderNumber ? `#${item.orderNumber}` : 'Satış öncesi'}</td>
                  <td className="px-4 py-3">
                    {item.status === 'waiting_for_seller' ? 'Satıcı yanıtı bekleniyor' : 'Yanıtlandı'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--color-muted-fg)' }}>
                    {formatDate(item.lastMessageAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? <UrlPagination page={page} totalPages={totalPages} /> : null}
    </div>
  )
}
