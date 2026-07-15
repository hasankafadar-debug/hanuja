import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Badge,
  PageHeader,
  Separator,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@hanuja/ui'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { maskIban, formatMoney } from '@hanuja/security'
import { createSellerFinanceService } from '@hanuja/api/services/seller-finance.service'
import { createPlatformSettingsService } from '@hanuja/api/services/platform-settings.service'
import { SellerAdminActions } from '@/components/seller-admin-actions'
import { SellerCommissionSettings } from '@/components/seller-commission-settings'
import { DocumentReviewActions } from '@/components/document-review-actions'
import { SellerImportPermission } from '@/components/seller-import-permission'
import { SellerStatusButtons } from '@/components/seller-status-buttons'
import { SellerAccountStatement } from './seller-account-statement'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function getSingleValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

function formatDateInput(date: Date) {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: `Satıcı — ${id.slice(-8).toUpperCase()}` }
}

const STATUS_MAP: Record<
  string,
  {
    label: string
    variant: 'success' | 'warning' | 'destructive' | 'secondary'
  }
> = {
  active: { label: 'Aktif', variant: 'success' },
  pending: { label: 'Onay Bekliyor', variant: 'warning' },
  suspended: { label: 'Askıya Alındı', variant: 'destructive' },
  rejected: { label: 'Reddedildi', variant: 'secondary' },
}

export default async function SellerDetailPage({ params, searchParams }: Props) {
  await getAdminSession()

  const { id } = await params
  const resolvedSearchParams = (await searchParams) ?? {}
  const prisma = createPrismaForRoute()

  const now = new Date()
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  const defaultFrom = new Date(defaultTo)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29)
  defaultFrom.setUTCHours(0, 0, 0, 0)
  const fromInput = getSingleValue(resolvedSearchParams.from) ?? formatDateInput(defaultFrom)
  const toInput = getSingleValue(resolvedSearchParams.to) ?? formatDateInput(defaultTo)
  const from = new Date(`${fromInput}T00:00:00.000Z`)
  const to = new Date(`${toInput}T23:59:59.999Z`)

  const seller = await prisma.seller.findUnique({
    where: { id },
    include: {
      profile: true,
      bankDetails: { where: { isActive: true }, take: 1 },
      user: { select: { email: true } },
    },
  })

  if (!seller) notFound()

  const service = createSellerFinanceService({ prisma })

  const [platformSettings, orderAgg, productCount, payoutGroups, ledgerAgg, commissionAgg, kycDocuments, penalties, statement] =
    await Promise.all([
      createPlatformSettingsService({ prisma }).get(),
      prisma.orderLine.aggregate({
        where: { sellerId: id },
        _count: { id: true },
        _sum: { totalPrice: true },
      }),
      prisma.product.count({ where: { sellerId: id } }),
      prisma.payout.groupBy({
        by: ['status'],
        where: { sellerId: id },
        _sum: { netAmount: true },
      }),
      prisma.sellerLedgerEntry.aggregate({
        where: { sellerId: id },
        _sum: { amount: true },
      }),
      prisma.orderLine.aggregate({
        where: { sellerId: id },
        _sum: { commissionAmount: true },
      }),
      prisma.sellerDocument.findMany({
        where: { sellerId: id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.penalty.findMany({
        where: { sellerId: id },
        include: { order: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      service.getStatement({
        sellerId: seller.id,
        from,
        to,
      }),
    ])

  const payoutMap = new Map(
    payoutGroups.map((group) => [group.status, Number(group._sum.netAmount ?? 0)]),
  )

  const pendingPayout = (payoutMap.get('hold_active') ?? 0) + (payoutMap.get('payout_blocked') ?? 0)
  const readyPayout = (payoutMap.get('payout_ready') ?? 0) + (payoutMap.get('payout_scheduled') ?? 0)
  const paidPayout = payoutMap.get('payout_paid') ?? 0
  const ledgerBalance = Number(ledgerAgg._sum.amount ?? 0)
  const commissionTotal = Number(commissionAgg._sum.commissionAmount ?? 0)

  const penaltyTotal = penalties
    .filter((penalty) => penalty.status !== 'waived')
    .reduce(
      (sum, penalty) =>
        sum +
        (typeof penalty.penaltyAmount === 'object'
          ? (penalty.penaltyAmount as { toNumber(): number }).toNumber()
          : Number(penalty.penaltyAmount)),
      0,
    )

  const activeBankDetail = seller.bankDetails[0] ?? null
  const statusInfo = STATUS_MAP[seller.status] ?? {
    label: seller.status,
    variant: 'secondary' as const,
  }
  const totalOrders = orderAgg._count.id
  const isNegativeBalance = ledgerBalance < 0
  const exportHref = `/api/admin/sellers/${seller.id}/statement?from=${fromInput}&to=${toInput}&format=xlsx`
  const effectiveCommissionRate =
    seller.commissionRateOverride ?? platformSettings.defaultSellerCommissionRate

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link
          href="/saticilar"
          className="mb-3 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" /> Satıcılara Dön
        </Link>
        <div className="flex items-start justify-between gap-4">
          <PageHeader
            title={seller.displayName}
            description={`ID: ${id.slice(-8).toUpperCase()} · Katılım: ${new Date(seller.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}`}
          />
          <div className="flex flex-col items-end gap-2">
            <SellerStatusButtons
              sellerId={seller.id}
              currentStatus={seller.status}
              displayName={seller.displayName}
            />
            <SellerAdminActions sellerId={seller.id} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Toplam Sipariş', value: totalOrders },
          {
            label: 'Bekleyen Hakediş',
            value: pendingPayout > 0 ? formatMoney(pendingPayout) : '—',
          },
          {
            label: 'Toplam Ödenen',
            value: paidPayout > 0 ? formatMoney(paidPayout) : '—',
          },
          {
            label: 'Toplam Ceza',
            value: penaltyTotal > 0 ? formatMoney(penaltyTotal) : '—',
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border p-4"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              {stat.label}
            </p>
            <p className="mt-1 text-xl font-bold" style={{ color: 'var(--color-primary)' }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="kyc">
            Belgeler
            {kycDocuments.filter((document) => document.status === 'pending').length > 0 && (
              <span
                className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
                style={{
                  backgroundColor: 'var(--color-warning)',
                  color: '#fff',
                }}
              >
                {kycDocuments.filter((document) => document.status === 'pending').length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="finance">Finans</TabsTrigger>
          <TabsTrigger value="statement">Hesap Ekstresi</TabsTrigger>
          <TabsTrigger value="penalties">Cezalar</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-5 space-y-4">
          <div
            className="rounded-xl border p-5"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <dl className="divide-y text-sm" style={{ borderColor: 'var(--color-border)' }}>
              {[
                { label: 'E-posta', value: seller.user.email },
                { label: 'Şehir', value: seller.profile?.city ?? '—' },
                { label: 'Ürün Sayısı', value: productCount },
                {
                  label: 'Durum',
                  value: <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>,
                },
                {
                  label: 'Etkin Komisyon',
                  value: `%${(effectiveCommissionRate.toNumber() * 100).toFixed(2)}`,
                },
                {
                  label: 'Profil Doğrulama',
                  value: seller.profile?.isVerified ? (
                    <Badge variant="success">Doğrulanmış</Badge>
                  ) : (
                    <Badge variant="warning">Doğrulanmadı</Badge>
                  ),
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-3">
                  <dt style={{ color: 'var(--color-muted-fg)' }}>{label}</dt>
                  <dd style={{ color: 'var(--color-primary)' }}>{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div
            className="rounded-xl border p-5"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                Banka Bilgileri
              </h3>
              {activeBankDetail ? (
                <Badge variant={activeBankDetail.isVerified ? 'success' : 'warning'}>
                  {activeBankDetail.isVerified ? 'Doğrulanmış' : 'Doğrulanmadı'}
                </Badge>
              ) : (
                <Badge variant="secondary">Banka Bilgisi Yok</Badge>
              )}
            </div>
            {activeBankDetail ? (
              <>
                <p className="text-sm font-mono" style={{ color: 'var(--color-muted-fg)' }}>
                  {maskIban(activeBankDetail.iban)}
                </p>
                <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  {activeBankDetail.accountHolder} · {activeBankDetail.bankName}
                </p>
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Aktif banka bilgisi tanımlanmamış.
              </p>
            )}
            <p
              className="mt-2 flex items-center gap-1 text-xs"
              style={{ color: 'var(--color-muted-fg)' }}
            >
              <ShieldAlert className="h-3.5 w-3.5" /> Tam IBAN yalnızca yetkili finans admin tarafından görülebilir.
            </p>
          </div>

          <SellerImportPermission
            sellerId={seller.id}
            importEnabled={seller.importEnabled}
            importRequestedAt={seller.importRequestedAt ? seller.importRequestedAt.toISOString() : null}
          />
          <SellerCommissionSettings
            sellerId={seller.id}
            defaultRate={platformSettings.defaultSellerCommissionRate.toString()}
            overrideRate={seller.commissionRateOverride?.toString() ?? null}
          />
        </TabsContent>

        <TabsContent value="statement" className="mt-5">
          <SellerAccountStatement
            from={from}
            fromInput={fromInput}
            toInput={toInput}
            exportHref={exportHref}
            statement={statement}
          />
        </TabsContent>

        <TabsContent value="kyc" className="mt-5">
          {kycDocuments.length === 0 ? (
            <div
              className="rounded-xl border px-5 py-10 text-center"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              <FileText className="mx-auto mb-2 h-8 w-8" style={{ color: 'var(--color-muted-fg)' }} />
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Bu satıcı henüz belge yüklemedi.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {kycDocuments.map((document) => {
                const statusIcon =
                  document.status === 'approved' ? (
                    <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
                  ) : document.status === 'rejected' ? (
                    <XCircle className="h-4 w-4" style={{ color: 'var(--color-destructive)' }} />
                  ) : (
                    <Clock className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
                  )

                const statusLabel =
                  document.status === 'approved'
                    ? 'Onaylandı'
                    : document.status === 'rejected'
                      ? 'Reddedildi'
                      : 'İnceleniyor'

                const typeLabels: Record<string, string> = {
                  identity: 'Kimlik Belgesi',
                  tax_certificate: 'Vergi Levhası',
                  trade_registry: 'Ticaret Sicil Gazetesi',
                  signature_circular: 'İmza Sirküleri',
                  bank_statement: 'Banka Hesap Cüzdanı',
                  other: 'Diğer Belge',
                }

                return (
                  <div
                    key={document.id}
                    className="space-y-3 rounded-xl border p-4"
                    style={{
                      borderColor:
                        document.status === 'pending'
                          ? 'var(--color-warning)'
                          : 'var(--color-border)',
                      backgroundColor: 'var(--color-surface)',
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <FileText
                        className="mt-0.5 h-5 w-5 shrink-0"
                        style={{ color: 'var(--color-muted-fg)' }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                            {typeLabels[document.type] ?? document.type}
                          </p>
                          <span className="inline-flex items-center gap-1 text-xs">
                            {statusIcon} {statusLabel}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                          {document.fileName} ·{' '}
                          {new Date(document.createdAt).toLocaleDateString('tr-TR', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                        {document.adminNote && (
                          <p className="mt-1 text-xs italic" style={{ color: 'var(--color-muted-fg)' }}>
                            Not: {document.adminNote}
                          </p>
                        )}
                      </div>
                      <a
                        href={document.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 rounded p-1.5 hover:bg-black/5"
                        title="Belgeyi görüntüle"
                      >
                        <ExternalLink className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
                      </a>
                    </div>
                    {document.status === 'pending' && (
                      <div className="pt-1">
                        <DocumentReviewActions documentId={document.id} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="finance" className="mt-5">
          <div
            className="rounded-xl border p-5"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <h3 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
              Cari Hesap Özeti
            </h3>
            <Separator className="mb-4" />
            <dl className="divide-y text-sm" style={{ borderColor: 'var(--color-border)' }}>
              {[
                {
                  label: 'Toplam Komisyon Kesintisi',
                  value: `-${formatMoney(commissionTotal)}`,
                  danger: commissionTotal > 0,
                },
                {
                  label: 'Toplam Ceza Kesintisi',
                  value: penaltyTotal > 0 ? `-${formatMoney(penaltyTotal)}` : '—',
                  danger: penaltyTotal > 0,
                },
                {
                  label: 'Beklemede (Hold + Bloke)',
                  value: pendingPayout > 0 ? formatMoney(pendingPayout) : '—',
                  danger: false,
                },
                {
                  label: 'Ödenmeye Hazır',
                  value: readyPayout > 0 ? formatMoney(readyPayout) : '—',
                  danger: false,
                },
                {
                  label: 'Ödenen Hakediş',
                  value: paidPayout > 0 ? formatMoney(paidPayout) : '—',
                  danger: false,
                },
                {
                  label: 'Ledger Bakiyesi',
                  value: formatMoney(ledgerBalance),
                  danger: isNegativeBalance,
                },
              ].map(({ label, value, danger }) => (
                <div key={label} className="flex justify-between py-3">
                  <dt style={{ color: 'var(--color-muted-fg)' }}>{label}</dt>
                  <dd
                    className="font-medium"
                    style={{
                      color: danger ? 'var(--color-destructive)' : 'var(--color-primary)',
                    }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </TabsContent>

        <TabsContent value="penalties" className="mt-5">
          <div
            className="overflow-hidden rounded-xl border"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            {penalties.length === 0 ? (
              <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Ceza kaydı yok.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                  <tr>
                    {['Sipariş', 'Tutar', 'Sebep', 'Tarih', 'Durum'].map((header) => (
                      <th
                        key={header}
                        className="px-4 py-3 text-left text-xs font-semibold"
                        style={{ color: 'var(--color-muted-fg)' }}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {penalties.map((penalty) => {
                    const amount =
                      typeof penalty.penaltyAmount === 'object'
                        ? (penalty.penaltyAmount as { toNumber(): number }).toNumber()
                        : Number(penalty.penaltyAmount)
                    return (
                      <tr
                        key={penalty.id}
                        className="border-t"
                        style={{ borderColor: 'var(--color-border)' }}
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/siparisler/${penalty.orderId}`}
                            className="font-medium hover:underline"
                            style={{ color: 'var(--color-accent)' }}
                          >
                            #{penalty.orderId.slice(-8).toUpperCase()}
                          </Link>
                        </td>
                        <td
                          className="px-4 py-3 font-medium"
                          style={{ color: 'var(--color-destructive)' }}
                        >
                          {formatMoney(amount)}
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                          {penalty.reason}
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                          {new Date(penalty.createdAt).toLocaleDateString('tr-TR', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={penalty.status as never} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
