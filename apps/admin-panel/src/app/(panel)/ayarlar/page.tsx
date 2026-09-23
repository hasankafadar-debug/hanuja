import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { Building2, Info, Lock, Mail } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createPlatformSettingsService } from '@hanuja/api/services/platform-settings.service'
import { createPlatformBankAccountService } from '@hanuja/api/services/platform-bank-account.service'
import { PlatformSettingsForm } from './_components/platform-settings-form'
import { BankAccountsForm } from './_components/bank-accounts-form'
import { createAdminNotificationRecipientService } from '@hanuja/api/services/admin-notification.service'
import { NotificationRecipientsForm } from './_components/notification-recipients-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sistem Ayarlari' }

export default async function AdminSettingsPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const platformSettings = await createPlatformSettingsService({ prisma }).get()
  const bankAccounts = await createPlatformBankAccountService({ prisma }).listAll()
  const notificationRecipients = await createAdminNotificationRecipientService({
    prisma,
  }).list()
  const sellerCount = await prisma.seller.count({ where: { status: 'active' } })
  const productPendingCount = await prisma.product.count({ where: { status: 'pending_review' } })

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Sistem Ayarlari" description="Platform duzeyinde yapilandirma" />

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
          Bu degerler yeni hesaplamalarda kullanilir; gecmis siparis snapshotlari degismez.
        </p>
        <PlatformSettingsForm
          initialValues={{
            standardPenaltyRate: platformSettings.standardPenaltyRate.toString(),
            dailyPenaltyRate: platformSettings.dailyPenaltyRate.toString(),
            defaultSellerCommissionRate: platformSettings.defaultSellerCommissionRate.toString(),
            fulfillmentDays: String(platformSettings.fulfillmentDays),
            fulfillmentWarningDays: String(platformSettings.fulfillmentWarningDays),
            payoutHoldDays: String(platformSettings.payoutHoldDays),
            freeShippingThresholdTry: platformSettings.freeShippingThresholdTry.toString(),
            flatShippingFeeTry: platformSettings.flatShippingFeeTry.toString(),
            eftDiscountRate: platformSettings.eftDiscountRate.toString(),
          }}
        />
      </section>

      <section
        className="space-y-1 rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="mb-4 flex items-center gap-2">
          <Building2 className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            EFT / Havale Banka Hesaplari
          </h2>
        </div>
        <p className="mb-4 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Müşterilerin havale/EFT yapacağı banka hesapları. Sipariş detay sayfası ve sipariş e-postasında gösterilir.
        </p>
        <BankAccountsForm initialAccounts={bankAccounts} />
      </section>

      <section
        className="space-y-1 rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            Bildirim Alicilari
          </h2>
        </div>
        <p className="mb-4 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Operasyon e-postalari bu adreslere gider. Panel bildirimleri tum adminlerde gorunmeye
          devam eder; buradaki adres yalnizca e-posta alicisini belirler ve olay basina tek
          e-posta gonderilir.
        </p>
        <NotificationRecipientsForm
          initialRecipients={notificationRecipients.map((row) => ({
            event: row.event,
            label: row.label,
            email: row.email,
          }))}
        />
      </section>

      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="mb-4 flex items-center gap-2">
          <Info className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            Komisyon Notu
          </h2>
        </div>
        <p className="mb-4 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Yeni siparislerde komisyon orani saticiya ozel oran varsa onu, yoksa burada tanimli
          genel satici komisyonunu kullanir. Siparis olustugunda oran satir bazinda snapshot
          olarak saklanir.
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
                color: productPendingCount > 0 ? 'var(--color-warning)' : 'var(--color-primary)',
              }}
            >
              {productPendingCount}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
