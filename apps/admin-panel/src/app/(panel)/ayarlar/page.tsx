import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { Info, Lock } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { buildCategoryTaxGroups } from '@hanuja/api/domain/category-tax-groups'
import { createPlatformSettingsService } from '@hanuja/api/services/platform-settings.service'
import { CategorySettingsList } from './_components/category-settings-list'
import { PlatformSettingsForm } from './_components/platform-settings-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sistem Ayarları' }

export default async function AdminSettingsPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const platformSettings = await createPlatformSettingsService({ prisma }).get()

  const categoryTaxGroups = buildCategoryTaxGroups(
    await prisma.category.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        sortOrder: true,
        isActive: true,
        taxRate: true,
        parent: {
          select: {
            id: true,
            name: true,
            parentId: true,
          },
        },
        children: {
          select: { id: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  )

  const sellerCount = await prisma.seller.count({ where: { status: 'active' } })
  const productPendingCount = await prisma.product.count({ where: { status: 'pending_review' } })

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Sistem Ayarları" description="Platform düzeyinde yapılandırma" />

      <section
        className="space-y-1 rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            Platform Sabitleri
          </h2>
        </div>
        <p className="mb-4 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
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
            eftDiscountRate: platformSettings.eftDiscountRate.toString(),
          }}
        />
      </section>

      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="mb-4 flex items-center gap-2">
          <Info className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            Komisyon Çözümleme Sırası
          </h2>
        </div>
        <p className="mb-4 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Komisyon oranı şu öncelik sırasıyla belirlenir: ürün özel oranı, kategori oranı, satıcı genel
          oranı ve sistem varsayılanı. Oranlar kategori ve satıcı kayıtlarında yönetilir.
        </p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--color-muted-fg)' }}>Aktif satıcı sayısı</span>
            <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>
              {sellerCount}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--color-muted-fg)' }}>Onay bekleyen ürün</span>
            <span
              className="font-semibold"
              style={{
                color: productPendingCount > 0 ? 'var(--color-warning)' : 'var(--color-primary)',
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
        <h2 className="mb-2 font-semibold" style={{ color: 'var(--color-primary)' }}>
          Kategori KDV Grupları
        </h2>
        <p className="mb-4 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Ev ve Ofis altındaki aynı adlı ana kategoriler tek satırda yönetilir. Yaprak kategoriler bu
          listede gösterilmez.
        </p>
        <CategorySettingsList categories={categoryTaxGroups} />
      </section>
    </div>
  )
}
