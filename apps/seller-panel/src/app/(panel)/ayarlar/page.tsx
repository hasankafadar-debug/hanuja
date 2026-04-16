import type { Metadata } from 'next'
import { Tabs, TabsList, TabsTrigger, TabsContent, PageHeader } from '@hanuja/ui'
import { getSellerFromSession } from '@/lib/seller-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import StoreProfileForm from './_components/store-profile-form'
import BankDetailsForm from './_components/bank-details-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ayarlar' }

export default async function SellerSettingsPage() {
  const { session, seller } = await getSellerFromSession()
  const prisma = createPrismaForRoute()

  // Profil ve banka bilgilerini çek
  const [sellerWithDetails, user] = await Promise.all([
    prisma.seller.findUnique({
      where: { id: seller.id },
      include: { profile: true, bankDetails: { where: { isActive: true }, take: 1 } },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, name: true },
    }),
  ])

  const profile = sellerWithDetails?.profile
  const activeBank = sellerWithDetails?.bankDetails?.[0] ?? null

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Mağaza Ayarları" description="Profil, banka ve güvenlik bilgileri" />

      <Tabs defaultValue="store">
        <TabsList>
          <TabsTrigger value="store">Mağaza Profili</TabsTrigger>
          <TabsTrigger value="bank">Banka Bilgileri</TabsTrigger>
          <TabsTrigger value="account">Hesap</TabsTrigger>
        </TabsList>

        <TabsContent value="store" className="mt-5">
          <div className="mb-4 space-y-1">
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              <span className="font-medium" style={{ color: 'var(--color-primary)' }}>Mağaza URL:</span>{' '}
              hanuja.com/magaza/{seller.slug}
              {' '}
              <span className="text-xs">(URL değişikliği admin onayı gerektirir)</span>
            </p>
          </div>
          <StoreProfileForm
            storeName={sellerWithDetails?.displayName ?? ''}
            bio={profile?.bio ?? ''}
            phone={profile?.phone ?? ''}
          />
        </TabsContent>

        <TabsContent value="bank" className="mt-5">
          <BankDetailsForm
            currentIban={activeBank?.iban ?? ''}
            currentAccountHolder={activeBank?.accountHolder ?? ''}
            currentBankName={activeBank?.bankName ?? ''}
            isVerified={activeBank?.isVerified ?? false}
          />
        </TabsContent>

        <TabsContent value="account" className="mt-5 space-y-4">
          <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>
              Hesap Bilgileri
            </p>
            <div>
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>Ad</p>
              <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                {user?.name ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>E-posta</p>
              <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                {user?.email ?? '—'}
              </p>
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            E-posta değişikliği için destek ekibimizle iletişime geçin.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
