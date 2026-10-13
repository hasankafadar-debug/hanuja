import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import CatalogManagement from './_components/catalog-management'
export const dynamic = 'force-dynamic'
export default async function Page() {
  await getAdminSession()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Kategori ve Özellik Yönetimi"
        description="Kategori ağacını, ürün şablonlarını ve seçeneklerini yönetin."
      />
      <CatalogManagement />
    </div>
  )
}
