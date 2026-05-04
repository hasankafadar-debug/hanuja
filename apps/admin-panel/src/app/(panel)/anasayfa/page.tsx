import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createHomeCmsService } from '@hanuja/api/services/home-cms.service'
import { HomeCmsManager } from './_components/home-cms-manager'
import type { HomeCmsInitialData } from './_components/types'

export const metadata: Metadata = { title: 'Ana Sayfa CMS' }

export const dynamic = 'force-dynamic'

export default async function HomeCmsPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const service = createHomeCmsService({ prisma })
  const [slides, promos, sellers] = await Promise.all([
    service.listAllSlides(),
    service.listAllPromos(),
    prisma.seller.findMany({
      where: { status: 'active' },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, slug: true },
    }),
  ])

  const initialData = JSON.parse(JSON.stringify({ slides, promos, sellers })) as HomeCmsInitialData

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ana Sayfa CMS"
        description="Hero slider ve sağ promo alanlarını yönetin"
      />

      <HomeCmsManager initialData={initialData} />
    </div>
  )
}
