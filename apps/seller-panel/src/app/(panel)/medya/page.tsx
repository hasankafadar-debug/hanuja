import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { getSellerFromSession } from '@/lib/seller-session'
import { MediaLibrary } from './_components/media-library'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Medya Havuzu',
}

export default async function MediaPage() {
  await getSellerFromSession()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Medya Havuzu"
        description="Ürün görsellerinizi sınırsız şekilde yükleyin, yönetin ve URL&apos;lerini toplu işlemlerde kullanın."
      />
      <MediaLibrary />
    </div>
  )
}
