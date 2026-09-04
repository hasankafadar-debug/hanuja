import Link from 'next/link'
import type { RefundTab } from '../../../../lib/admin-refund-list-params'

export function RefundQueueTabs({
  tab,
  counts,
}: {
  tab: RefundTab
  counts: { pendingManualRefunds: number; failedCardRefunds: number }
}) {
  return (
    <nav aria-label="İade listeleri" className="flex flex-wrap gap-2">
      {[
        { key: 'requests', label: 'İade talepleri', href: '/iadeler', count: null },
        {
          key: 'manual_refunds',
          label: 'Manuel ödeme iadeleri',
          href: '/iadeler?tab=manual_refunds',
          count: counts.pendingManualRefunds,
        },
        {
          key: 'failed_card_refunds',
          label: 'Başarısız kart iadeleri',
          href: '/iadeler?tab=failed_card_refunds',
          count: counts.failedCardRefunds,
        },
      ].map((item) => (
        <Link
          key={item.key}
          href={item.href}
          prefetch={false}
          aria-current={tab === item.key ? 'page' : undefined}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors hover:bg-[var(--color-muted)] ${tab === item.key ? 'border-[var(--color-accent)] bg-[var(--color-muted)] text-[var(--color-primary)]' : 'border-[var(--color-border)] text-stone-600'}`}
        >
          {item.label}
          {item.count !== null && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${item.count > 0 ? 'bg-[#dcfce7] text-green-800' : 'bg-[var(--color-surface)] text-stone-600'}`}
            >
              {item.count}
              <span className="sr-only"> iade işlemi{item.count > 0 ? ' bekliyor' : ''}</span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  )
}
