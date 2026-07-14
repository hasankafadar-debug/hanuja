import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@hanuja/ui'
import { getSellerFromSession } from '@/lib/seller-session'
import { CouponForm } from '../../_components/coupon-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Yeni Kupon',
}

export default async function NewCouponPage() {
  // Oturum doğrulaması (satıcı değilse yönlendirir); kupon oluşturma API'si
  // sellerId'yi tekrar oturumdan çözer — bu sayfa yalnız formu barındırır.
  await getSellerFromSession()

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/indirimler"
          className="mb-4 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" />
          İndirimlere Dön
        </Link>
        <PageHeader
          title="Yeni Kupon"
          description="Müşterilerin ödeme adımında kullanabileceği bir indirim kodu oluşturun."
        />
      </div>

      <CouponForm />
    </div>
  )
}
