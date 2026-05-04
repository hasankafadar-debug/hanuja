import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { Shield } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Denetim Günlüğü' }

const ACTION_LABELS: Record<string, string> = {
  payout_released: 'Hakediş Ödendi',
  payout_blocked: 'Hakediş Bloke',
  eft_approved: 'EFT Onaylandı',
  eft_rejected: 'EFT Reddedildi',
  penalty_waived: 'Ceza Muafiyeti',
  penalty_applied: 'Ceza Uygulandı',
  seller_suspended: 'Satıcı Askıya Alındı',
  seller_activated: 'Satıcı Aktifleştirildi',
  delivery_confirmed_manual: 'Manuel Teslim Onayı',
  return_approved: 'İade Onaylandı',
  return_rejected: 'İade Reddedildi',
  dispute_resolved: 'Uyuşmazlık Çözüldü',
  order_cancelled: 'Sipariş İptal',
  refund_issued: 'İade Yapıldı',
  manual_adjustment: 'Manuel Düzenleme',
}

const ACTION_COLORS: Record<string, string> = {
  payout_released: 'var(--color-success)',
  payout_blocked: 'var(--color-destructive)',
  eft_approved: '#0ea5e9',
  eft_rejected: 'var(--color-destructive)',
  penalty_waived: '#f59e0b',
  penalty_applied: 'var(--color-destructive)',
  seller_suspended: 'var(--color-destructive)',
  seller_activated: 'var(--color-success)',
  delivery_confirmed_manual: '#8b5cf6',
  return_approved: 'var(--color-success)',
  return_rejected: 'var(--color-destructive)',
  dispute_resolved: '#8b5cf6',
  order_cancelled: 'var(--color-destructive)',
  refund_issued: '#f59e0b',
  manual_adjustment: '#f59e0b',
}

export default async function AuditLogPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const repo = createAdminAuditLogRepository(prisma)
  const logs = await repo.listRecent({ take: 100 })

  const fmt = (d: Date) =>
    d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-6" data-testid="admin-audit-page">
      <PageHeader
        title="Denetim Günlüğü"
        description="Tüm yüksek etkili admin işlemleri"
      />

      <div
        className="rounded-xl border p-4 text-sm flex items-start gap-2"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <Shield className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-muted-fg)' }} />
        <p style={{ color: 'var(--color-muted-fg)' }}>
          Tüm kayıtlar salt okunur ve değiştirilemez. Her işlem aktör, zaman ve gerekçe ile saklanır.
        </p>
      </div>

      <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <table className="w-full text-sm whitespace-nowrap">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Aktör', 'İşlem', 'Hedef', 'Tür', 'Tarih', 'Gerekçe'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  Henüz denetim kaydı yok.
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr
                key={log.id}
                data-testid="audit-row"
                className="border-t hover:bg-[var(--color-muted)]"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--color-muted-fg)' }}>
                  {log.actorId.slice(0, 8)}…
                </td>
                <td className="px-4 py-3">
                  <span
                    className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: ACTION_COLORS[log.actionType] ?? 'var(--color-muted-fg)' }}
                  >
                    {ACTION_LABELS[log.actionType] ?? log.actionType}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--color-primary)' }}>
                  {log.targetId.slice(0, 10)}…
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {log.targetType}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {fmt(log.createdAt)}
                </td>
                <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-muted-fg)' }}>
                  {log.reason ?? log.note ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
