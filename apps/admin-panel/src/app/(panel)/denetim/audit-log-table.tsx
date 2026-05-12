'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@hanuja/ui'

type AuditRow = {
  id: string
  actorId: string
  actionType: string
  targetType: string
  targetId: string
  reason: string | null
  note: string | null
  createdAt: string | Date
  actor?: { email: string; name: string | null } | null
}

const ACTION_LABELS: Record<string, string> = {
  payout_released: 'Hakedis odendi',
  payout_blocked: 'Hakedis blokesi',
  penalty_waived: 'Ceza muafiyeti',
  penalty_applied: 'Ceza uygulandi',
  seller_suspended: 'Satici askiya alindi',
  seller_activated: 'Satici aktive edildi',
  order_cancelled: 'Siparis iptali',
  refund_issued: 'Iade yapildi',
  category_tax_rate_changed: 'Kategori vergi orani degisti',
  seller_commission_rate_changed: 'Satici komisyonu degisti',
}

const ACTION_COLORS: Record<string, string> = {
  payout_released: 'var(--color-success)',
  payout_blocked: 'var(--color-destructive)',
  penalty_waived: '#f59e0b',
  penalty_applied: 'var(--color-destructive)',
  seller_suspended: 'var(--color-destructive)',
  seller_activated: 'var(--color-success)',
  order_cancelled: 'var(--color-destructive)',
  refund_issued: '#f59e0b',
  category_tax_rate_changed: '#0ea5e9',
  seller_commission_rate_changed: '#8b5cf6',
}

interface AuditLogTableProps {
  initialRows: AuditRow[]
}

const ACTION_OPTIONS = [
  'payout_released',
  'payout_blocked',
  'penalty_waived',
  'penalty_applied',
  'seller_suspended',
  'seller_activated',
  'order_cancelled',
  'category_tax_rate_changed',
  'seller_commission_rate_changed',
]

export function AuditLogTable({ initialRows }: AuditLogTableProps) {
  const [rows, setRows] = useState(initialRows)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(initialRows.length === 50)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [actorEmail, setActorEmail] = useState('')
  const [selectedActions, setSelectedActions] = useState<string[]>([])
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const query = useMemo(
    () => ({
      from,
      to,
      actorEmail,
      actionType: selectedActions.join(','),
    }),
    [actorEmail, from, selectedActions, to],
  )

  async function fetchLogs(reset = false) {
    if (loading) return
    setLoading(true)

    try {
      const search = new URLSearchParams()
      search.set('take', '50')
      search.set('skip', reset ? '0' : String(rows.length))
      if (query.from) search.set('from', query.from)
      if (query.to) search.set('to', query.to)
      if (query.actorEmail) search.set('actorEmail', query.actorEmail)
      if (query.actionType) search.set('actionType', query.actionType)

      const response = await fetch(`/api/admin/audit-logs?${search.toString()}`, {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({}))
      const nextRows = (payload.data ?? []) as AuditRow[]

      setRows((current) => (reset ? nextRows : [...current, ...nextRows]))
      setHasMore(nextRows.length === 50)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchLogs(true)
    }, 250)
    return () => window.clearTimeout(timeoutId)
  }, [query])

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void fetchLogs()
        }
      },
      { rootMargin: '160px' },
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, rows.length, query])

  function toggleAction(action: string) {
    setSelectedActions((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <Input
          placeholder="Actor email"
          value={actorEmail}
          onChange={(event) => setActorEmail(event.target.value)}
        />
        <div
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {selectedActions.length > 0
            ? `${selectedActions.length} action selected`
            : 'All actions'}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {ACTION_OPTIONS.map((action) => {
          const active = selectedActions.includes(action)
          return (
            <button
              key={action}
              type="button"
              onClick={() => toggleAction(action)}
              className="rounded-full border px-3 py-1.5 text-xs font-medium"
              style={{
                borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: active ? 'var(--color-muted)' : 'transparent',
                color: active ? 'var(--color-primary)' : 'var(--color-muted-fg)',
              }}
            >
              {ACTION_LABELS[action] ?? action}
            </button>
          )
        })}
      </div>

      <div
        className="overflow-x-auto rounded-xl border"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <table className="w-full whitespace-nowrap text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Actor', 'Action', 'Target', 'Type', 'Date', 'Reason'].map((heading) => (
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
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  No audit records found.
                </td>
              </tr>
            ) : (
              rows.map((log) => (
                <tr
                  key={log.id}
                  data-testid="audit-row"
                  className="border-t hover:bg-[var(--color-muted)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td
                    className="px-4 py-3 text-xs"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {log.actor?.email ?? `${log.actorId.slice(0, 8)}...`}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                      style={{
                        backgroundColor:
                          ACTION_COLORS[log.actionType] ?? 'var(--color-muted-fg)',
                      }}
                    >
                      {ACTION_LABELS[log.actionType] ?? log.actionType}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 font-mono text-xs"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    {log.targetId.slice(0, 10)}...
                  </td>
                  <td
                    className="px-4 py-3 text-xs"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {log.targetType}
                  </td>
                  <td
                    className="px-4 py-3 text-xs"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {new Date(log.createdAt).toLocaleString('tr-TR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td
                    className="max-w-xs truncate px-4 py-3 text-xs"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {log.reason ?? log.note ?? '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        ref={loadMoreRef}
        className="py-2 text-center text-sm"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        {loading ? 'Loading more records...' : hasMore ? 'Scroll to load more' : 'All records loaded'}
      </div>
    </div>
  )
}
