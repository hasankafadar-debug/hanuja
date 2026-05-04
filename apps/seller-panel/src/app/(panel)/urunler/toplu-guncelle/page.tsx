import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@hanuja/ui'
import { getSellerFromSession } from '@/lib/seller-session'
import { BulkUpdateForm } from './_components/bulk-update-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Toplu Guncelle',
}

export default async function BulkUpdatePage() {
  await getSellerFromSession()

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link
          href="/urunler"
          className="mb-4 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" />
          Urunlere Don
        </Link>
        <PageHeader
          title="Toplu Guncelle"
          description="Barkod ile urunlerin fiyat ve stok degerlerini toplu olarak guncelleyin."
        />
      </div>

      <BulkUpdateForm />
    </div>
  )
}
