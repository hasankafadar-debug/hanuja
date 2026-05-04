import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { Info, Lock } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { CategorySettingsList } from './_components/category-settings-list'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sistem Ayarlari' }

export default async function AdminSettingsPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()

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
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: 20,
  })

  const sellerCount = await prisma.seller.count({ where: { status: 'active' } })
  const productPendingCount = await prisma.product.count({ where: { status: 'pending_review' } })

  const row = (label: string, value: string, note?: string) => (
    <div
      className="flex items-start justify-between gap-4 py-3 border-b last:border-0"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          {label}
        </p>
        {note ? (
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>
            {note}
          </p>
        ) : null}
      </div>
      <span
        className="text-sm font-semibold shrink-0"
        style={{ color: 'var(--color-accent)' }}
      >
        {value}
      </span>
    </div>
  )

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
          Bu degerler is kurallari ve yasal mevzuat kapsaminda sabittir. Degistirmek icin
          politika ve mevzuat incelemesi gerekir.
        </p>
        {row(
          'Ceza Orani',
          '%20',
          'Odenen siparisi reddeden veya 20 gunluk teslimat taahhudunu ihlal eden saticiya uygulanir.',
        )}
        {row(
          'Hakedis Bekleme Suresi',
          '30 gun',
          'Teslim onayindan itibaren baslar. Iade/uyusmazlik varsa bloke kalir.',
        )}
        {row(
          'Kargo Taahhut Suresi',
          '20 gun',
          'Saticinin kargoya verme yukumlulugudur. Asilirse ceza degerlendirmesi baslar.',
        )}
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
