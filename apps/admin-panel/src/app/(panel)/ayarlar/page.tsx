import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { Info, Lock } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sistem Ayarları' }

export default async function AdminSettingsPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()

  // Commission resolution order: product → category → seller → system default
  // Pull the category-level rates to show in the summary
  const categories = await prisma.category.findMany({
    where: { parentId: null },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
    take: 20,
  })

  const sellerCount = await prisma.seller.count({ where: { status: 'active' } })
  const productPendingCount = await prisma.product.count({ where: { status: 'pending_review' } })

  const row = (label: string, value: string, note?: string) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>{label}</p>
        {note && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>{note}</p>}
      </div>
      <span className="text-sm font-semibold shrink-0" style={{ color: 'var(--color-accent)' }}>{value}</span>
    </div>
  )

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Sistem Ayarları" description="Platform düzeyinde yapılandırma" />

      {/* Platform Constants */}
      <section
        className="rounded-xl border p-5 space-y-1"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Lock className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Platform Sabitleri</h2>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted-fg)' }}>
          Bu değerler iş kuralları ve yasal mevzuat kapsamında sabittir. Değiştirmek için politika ve mevzuat incelemesi gerekir.
        </p>
        {row('Ceza Oranı', '%20', 'Ödenen siparişi reddeden veya 20 günlük teslimat taahhüdünü ihlal eden satıcıya uygulanır.')}
        {row('Hakediş Bekleme Süresi', '30 gün', 'Teslim onayından itibaren başlar. İade/uyuşmazlık varsa bloke kalır.')}
        {row('Kargo Taahhüt Süresi', '20 gün', 'Satıcının kargoya verme yükümlülüğü. Aşılırsa ceza değerlendirmesi başlar.')}
      </section>

      {/* Commission Resolution Info */}
      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Info className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Komisyon Çözümleme Sırası</h2>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted-fg)' }}>
          Komisyon oranı şu öncelik sırasıyla belirlenir: Ürün özel oranı → Kategori oranı → Satıcı genel oranı → Sistem varsayılanı.
          Oranlar kategori ve satıcı kayıtlarında yönetilir.
        </p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--color-muted-fg)' }}>Aktif satıcı sayısı</span>
            <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>{sellerCount}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--color-muted-fg)' }}>Onay bekleyen ürün</span>
            <span className="font-semibold" style={{ color: productPendingCount > 0 ? 'var(--color-warning)' : 'var(--color-primary)' }}>
              {productPendingCount}
            </span>
          </div>
        </div>
      </section>

      {/* Root Categories */}
      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <h2 className="font-semibold mb-4" style={{ color: 'var(--color-primary)' }}>Kök Kategoriler</h2>
        {categories.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>Henüz kategori tanımlanmamış.</p>
        )}
        <div className="space-y-1">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between py-2 border-b last:border-0 text-sm"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <span style={{ color: 'var(--color-primary)' }}>{cat.name}</span>
              <span className="font-mono text-xs" style={{ color: 'var(--color-muted-fg)' }}>/kategori/{cat.slug}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
