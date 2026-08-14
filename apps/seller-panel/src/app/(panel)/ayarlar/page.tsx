import type { Metadata } from 'next'
import { Tabs, TabsList, TabsTrigger, TabsContent, PageHeader } from '@hanuja/ui'
import { maskIban } from '@hanuja/security'
import { getSellerFromSession } from '@/lib/seller-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import StoreProfileForm from './_components/store-profile-form'
import StoreBrandForm from './_components/store-brand-form'
import BankDetailsForm from './_components/bank-details-form'
import DocumentsForm from './_components/documents-form'
import VacationModeForm from './_components/vacation-mode-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ayarlar' }

export default async function SellerSettingsPage() {
  const { session, seller } = await getSellerFromSession()
  const prisma = createPrismaForRoute()

  // Profil ve banka bilgilerini çek
  const [sellerWithDetails, user, sellerDocuments] = await Promise.all([
    prisma.seller.findUnique({
      where: { id: seller.id },
      include: {
        profile: true,
        bankDetails: { orderBy: { createdAt: 'desc' }, take: 10 },
        bankDetailHistory: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, name: true },
    }),
    prisma.sellerDocument.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const profile = sellerWithDetails?.profile
  const activeBank = sellerWithDetails?.bankDetails?.find((detail) => detail.status === 'ACTIVE' || detail.isActive) ?? null
  const pendingBank = sellerWithDetails?.bankDetails?.find((detail) => detail.status === 'PENDING_ACTIVATION') ?? null

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Mağaza Ayarları" description="Profil, banka ve güvenlik bilgileri" />

      <Tabs defaultValue="store">
        <TabsList>
          <TabsTrigger value="store">Mağaza Profili</TabsTrigger>
          <TabsTrigger value="bank">Banka Bilgileri</TabsTrigger>
          <TabsTrigger value="documents">Belgeler</TabsTrigger>
          <TabsTrigger value="vacation">Tatil Modu</TabsTrigger>
          <TabsTrigger value="account">Hesap</TabsTrigger>
        </TabsList>

        <TabsContent value="store" className="mt-5">
          <div className="mb-4 space-y-1">
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              <span className="font-medium" style={{ color: 'var(--color-primary)' }}>Mağaza URL:</span>{' '}
              www.hanuja.com.tr/magaza/{seller.slug}
              {' '}
              <span className="text-xs">(URL değişikliği admin onayı gerektirir)</span>
            </p>
          </div>

          {/* Mağaza görselleri — logo ve banner */}
          <div
            className="mb-8 rounded-xl border p-5"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <StoreBrandForm
              logoUrl={profile?.logoUrl ?? null}
              bannerUrl={profile?.bannerUrl ?? null}
              bannerColor={profile?.bannerColor ?? null}
              bannerHeadline={profile?.bannerHeadline ?? null}
              bannerTextColor={profile?.bannerTextColor ?? null}
              bannerHeadlineFontSize={profile?.bannerHeadlineFontSize ?? null}
            />
          </div>

          <StoreProfileForm
            storeName={sellerWithDetails?.displayName ?? ''}
            bio={profile?.bio ?? ''}
            phone={profile?.phone ?? ''}
            companyName={profile?.companyName ?? ''}
            legalAddress={profile?.legalAddress ?? ''}
            district={profile?.district ?? ''}
            city={profile?.city ?? ''}
            postalCode={profile?.postalCode ?? ''}
            taxOffice={profile?.taxOffice ?? ''}
            taxNumber={profile?.taxNumber ?? ''}
            mersis={profile?.mersis ?? ''}
          />
        </TabsContent>

        <TabsContent value="bank" className="mt-5">
          <BankDetailsForm
            currentIban={activeBank?.iban ? maskIban(activeBank.iban) : ''}
            currentAccountHolder={activeBank?.accountHolder ?? ''}
            currentBankName={activeBank?.bankName ?? ''}
            isVerified={activeBank?.isVerified ?? false}
            userEmail={user?.email ?? ''}
            pendingRequest={pendingBank ? {
              id: pendingBank.id,
              ibanMasked: maskIban(pendingBank.iban),
              bankName: pendingBank.bankName,
              activatesAt: pendingBank.activatesAt?.toISOString() ?? null,
              blockedReason: pendingBank.blockedReason ?? null,
              flags: pendingBank.flags ?? null,
            } : null}
            history={sellerWithDetails?.bankDetailHistory.map((entry) => ({
              id: entry.id,
              action: entry.action,
              ibanMasked: entry.ibanMasked,
              previousIbanMasked: entry.previousIbanMasked ?? null,
              createdAt: entry.createdAt.toISOString(),
              reason: entry.reason ?? null,
            })) ?? []}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-5">
          <DocumentsForm
            initialDocuments={sellerDocuments.map((d) => ({
              id: d.id,
              type: d.type,
              status: d.status,
              identityPart: d.identityPart,
              uploadGroupId: d.uploadGroupId,
              uploadOrder: d.uploadOrder,
              uploadGroupSize: d.uploadGroupSize,
              fileName: d.fileName,
              mimeType: d.mimeType,
              sizeBytes: d.sizeBytes,
              fileUrl: d.fileUrl,
              adminNote: d.adminNote ?? null,
              createdAt: d.createdAt.toISOString(),
            }))}
          />
        </TabsContent>

        <TabsContent value="vacation" className="mt-5">
          <VacationModeForm enabled={sellerWithDetails?.vacationModeEnabled ?? false} />
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
