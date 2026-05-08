import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { Info, Lock } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createPlatformSettingsService } from '@hanuja/api/services/platform-settings.service'
import { CategorySettingsList } from './_components/category-settings-list'
import { PlatformSettingsForm } from './_components/platform-settings-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sistem Ayarlari' }

export default async function AdminSettingsPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const platformSettings = await createPlatformSettingsService({ prisma }).get()

  const categories = await prisma.category.findMany({
    where: { parentId: null },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      sortOrder: true,
      isActive: true,
      taxRate: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: 20,
  })

  const sellerCount = await prisma.seller.count({ where: { status: 'active' } })
  const productPendingCount = await prisma.product.count({ where: { status: 'pending_review' } })

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Sistem Ayarlari" description="Platform duzeyinde yapilandirma" />

      <section
        className="rounded-xl border p-5 space-y-1"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Lock className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            Platform Sabitleri
          </h2>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted-fg)' }}>
          Bu değerler yeni hesaplamalarda kullanılır; geçmiş sipariş snapshotları değişmez.
        </p>
        <PlatformSettingsForm
          initialValues={{
            standardPenaltyRate: platformSettings.standardPenaltyRate.toString(),
            fulfillmentDays: String(platformSettings.fulfillmentDays),
            fulfillmentWarningDays: String(platformSettings.fulfillmentWarningDays),
            payoutHoldDays: String(platformSettings.payoutHoldDays),
            freeShippingThresholdTry: platformSettings.freeShippingThresholdTry.toString(),
            flatShippingFeeTry: platformSettings.flatShippingFeeTry.toString(),
            defaultTaxRate: platformSettings.defaultTaxRate.toString(),
          }}
        />
      </section>

      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Info className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            Komisyon Cozumleme Sirasi
          </h2>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted-fg)' }}>
          Komisyon orani su oncelik sirasiyla belirlenir: urun ozel orani, kategori orani,
          satici genel orani ve sistem varsayilani. Oranlar kategori ve satici kayitlarinda
          yonetilir.
        </p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--color-muted-fg)' }}>Aktif satici sayisi</span>
            <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>
              {sellerCount}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--color-muted-fg)' }}>Onay bekleyen urun</span>
            <span
              className="font-semibold"
              style={{
                color:
                  productPendingCount > 0
                    ? 'var(--color-warning)'
                    : 'var(--color-primary)',
              }}
            >
              {productPendingCount}
            </span>
          </div>
        </div>
      </section>

      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <h2 className="font-semibold mb-4" style={{ color: 'var(--color-primary)' }}>
          Kok Kategoriler
        </h2>
        <CategorySettingsList categories={categories} />
      </section>
    </div>
  )
}
