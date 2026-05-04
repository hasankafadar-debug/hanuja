import { getStatusLabel } from '@hanuja/ui'

interface TimelineItem {
  id: string
  toStatus: string
  note?: string | null
  reason?: string | null
  createdAt: Date
}

export default function OrderTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
        Surec Zaman Cizelgesi
      </h2>
      <div className="space-y-4">
        {items.map((item, index) => (
          <div key={item.id} className="flex gap-3">
            <div className="flex w-5 flex-col items-center">
              <span
                className="mt-1 h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: 'var(--color-accent)' }}
              />
              {index < items.length - 1 ? (
                <span
                  className="mt-1 h-full w-px"
                  style={{ backgroundColor: 'var(--color-border)' }}
                />
              ) : null}
            </div>
            <div className="flex-1 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                  {getStatusLabel(item.toStatus)}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {new Date(item.createdAt).toLocaleString('tr-TR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              {item.note || item.reason ? (
                <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  {item.note ?? item.reason}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
