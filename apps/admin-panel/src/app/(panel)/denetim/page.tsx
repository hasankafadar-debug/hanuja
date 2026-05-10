import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { Shield } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createAdminAuditLogRepository } from '@hanuja/api/repositories/admin-audit-log.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { AuditLogTable } from './audit-log-table'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Denetim Gunlugu' }

export default async function AuditLogPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const repo = createAdminAuditLogRepository(prisma)
  const initialRows = await repo.listRecent({ take: 50 })

  return (
    <div className="space-y-6" data-testid="admin-audit-page">
      <PageHeader
        title="Denetim Gunlugu"
        description="Tum yuksek etkili admin islemleri"
      />

      <div
        className="rounded-xl border p-4 text-sm flex items-start gap-2"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <Shield className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-muted-fg)' }} />
        <p style={{ color: 'var(--color-muted-fg)' }}>
          Tum kayitlar salt okunur ve degistirilemez. Her islem aktor, zaman ve gerekce ile saklanir.
        </p>
      </div>

      <AuditLogTable initialRows={initialRows as never} />
    </div>
  )
}
