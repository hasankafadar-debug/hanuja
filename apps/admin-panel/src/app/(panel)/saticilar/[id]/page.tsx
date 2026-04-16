import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, PageHeader, Separator, StatusBadge, Tabs, TabsList, TabsTrigger, TabsContent } from '@hanuja/ui'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { SellerStatusButtons } from '@/components/seller-status-buttons'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: `Satıcı — ${id.slice(-8).toUpperCase()}` }
}

const STATUS_MAP: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  active: { label: 'Aktif', variant: 'success' },
  pending: { label: 'Onay Bekliyor', variant: 'warning' },
  suspended: { label: 'Askıya Alındı', variant: 'destructive' },
  rejected: { label: 'Reddedildi', variant: 'secondary' },
}

export default async function SellerDetailPage({ params }: Props) {
  await getAdminSession()

  const { id } = await params
  const prisma = createPrismaForRoute()

  // Satıcı + profil + aktif banka bilgisi
  const seller = await prisma.seller.findUnique({
    where: { id },
    include: {
      profile: true,
      bankDetails: { where: { isActive: true }, take: 1 },
      user: { select: { email: true } },
    },
  })

  if (!seller) notFound()

  // Sipariş sayısı ve hacmi
  const orderAgg = await prisma.orderLine.aggregate({
    where: { sellerId: id },
    _count: { id: true },
    _sum: { totalPrice: true },
  })

  // Ürün sayısı
  const productCount = await prisma.product.count({ where: { sellerId: id } })

  // Payout özeti — duruma göre toplamlar
  const payoutGroups = await prisma.payout.groupBy({
    by: ['status'],
    where: { sellerId: id },
    _sum: { netAmount: true },
  })

  const payoutMap = new Map(
    payoutGroups.map((g) => [g.status, Number(g._sum.netAmount ?? 0)]),
  )

  const pendingPayout =
    (payoutMap.get('hold_active') ?? 0) + (payoutMap.get('payout_blocked') ?? 0)
  const readyPayout =
    (payoutMap.get('payout_ready') ?? 0) + (payoutMap.get('payout_scheduled') ?? 0)
  const paidPayout = payoutMap.get('payout_paid') ?? 0

  // Ledger bakiyesi
  const ledgerAgg = await prisma.sellerLedgerEntry.aggregate({
    where: { sellerId: id },
    _sum: { amount: true },
  })
  const ledgerBalance = Number(ledgerAgg._sum.amount ?? 0)

  // Komisyon kesintisi toplamı
  const commissionAgg = await prisma.orderLine.aggregate({
    where: { sellerId: id },
    _sum: { commissionAmount: true },
  })
  const commissionTotal = Number(commissionAgg._sum.commissionAmount ?? 0)

  // Ceza listesi
  const penalties = await prisma.penalty.findMany({
    where: { sellerId: id },
    include: { order: { select: { id: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const penaltyTotal = penalties
    .filter((p) => p.status !== 'waived')
    .reduce(
      (sum, p) =>
        sum +
        (typeof p.penaltyAmount === 'object'
          ? (p.penaltyAmount as { toNumber(): number }).toNumber()
          : Number(p.penaltyAmount)),
      0,
    )

  const activeBankDetail = seller.bankDetails[0] ?? null
  const statusInfo = STATUS_MAP[seller.status] ?? { label: seller.status, variant: 'secondary' as const }
  const totalOrders = orderAgg._count.id
  const isNegativeBalance = ledgerBalance < 0

  return (
    <div className="space-y-6 max-w-4xl">
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
          <SellerStatusButtons sellerId={seller.id} currentStatus={seller.status} />
        </div>
      </div>

      {/* Özet kartlar */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Toplam Sipariş', value: totalOrders },
          { label: 'Bekleyen Hakediş', value: pendingPayout > 0 ? `₺${pendingPayout.toLocaleString('tr-TR')}` : '—' },
          { label: 'Toplam Ödenen', value: paidPayout > 0 ? `₺${paidPayout.toLocaleString('tr-TR')}` : '—' },
          { label: 'Toplam Ceza', value: penaltyTotal > 0 ? `₺${penaltyTotal.toLocaleString('tr-TR')}` : '—' },
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
          <TabsTrigger value="finance">Finans</TabsTrigger>
          <TabsTrigger value="penalties">Cezalar</TabsTrigger>
        </TabsList>

        {/* Profil */}
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
                  value: (
                    <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  ),
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

          {/* Banka bilgisi */}
          <div
            className="rounded-xl border p-5"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <div className="flex items-center justify-between mb-3">
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
                  {activeBankDetail.iban.replace(/(.{4})/g, '$1 ').trim()}
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--color-muted-fg)' }}>
                  {activeBankDetail.accountHolder} · {activeBankDetail.bankName}
                </p>
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Aktif banka bilgisi tanımlanmamış.
              </p>
            )}
            <p
              className="mt-2 text-xs flex items-center gap-1"
              style={{ color: 'var(--color-muted-fg)' }}
            >
              <ShieldAlert className="h-3.5 w-3.5" /> Tam IBAN yalnızca yetkili finans
              admin tarafından görülebilir.
            </p>
          </div>
        </TabsContent>

        {/* Finans */}
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
                  value: `-₺${commissionTotal.toLocaleString('tr-TR')}`,
                  danger: commissionTotal > 0,
                },
                {
                  label: 'Toplam Ceza Kesintisi',
                  value: penaltyTotal > 0 ? `-₺${penaltyTotal.toLocaleString('tr-TR')}` : '—',
                  danger: penaltyTotal > 0,
                },
                {
                  label: 'Beklemede (Hold + Bloke)',
                  value: pendingPayout > 0 ? `₺${pendingPayout.toLocaleString('tr-TR')}` : '—',
                  danger: false,
                },
                {
                  label: 'Ödenmeye Hazır',
                  value: readyPayout > 0 ? `₺${readyPayout.toLocaleString('tr-TR')}` : '—',
                  danger: false,
                },
                {
                  label: 'Ödenen Hakediş',
                  value: paidPayout > 0 ? `₺${paidPayout.toLocaleString('tr-TR')}` : '—',
                  danger: false,
                },
                {
                  label: 'Ledger Bakiyesi',
                  value: isNegativeBalance
                    ? `-₺${Math.abs(ledgerBalance).toLocaleString('tr-TR')}`
                    : ledgerBalance > 0
                    ? `₺${ledgerBalance.toLocaleString('tr-TR')}`
                    : '₺0',
                  danger: isNegativeBalance,
                },
              ].map(({ label, value, danger }) => (
                <div key={label} className="flex justify-between py-3">
                  <dt style={{ color: 'var(--color-muted-fg)' }}>{label}</dt>
                  <dd
                    className="font-medium"
                    style={{
                      color: danger
                        ? 'var(--color-destructive)'
                        : 'var(--color-primary)',
                    }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </TabsContent>

        {/* Cezalar */}
        <TabsContent value="penalties" className="mt-5">
          <div
            className="rounded-xl border overflow-hidden"
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
                    {['Sipariş', 'Tutar', 'Sebep', 'Tarih', 'Durum'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold"
                        style={{ color: 'var(--color-muted-fg)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {penalties.map((p) => {
                    const amount =
                      typeof p.penaltyAmount === 'object'
                        ? (p.penaltyAmount as { toNumber(): number }).toNumber()
                        : Number(p.penaltyAmount)
                    return (
                      <tr
                        key={p.id}
                        className="border-t"
                        style={{ borderColor: 'var(--color-border)' }}
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/siparisler/${p.orderId}`}
                            className="hover:underline font-medium"
                            style={{ color: 'var(--color-accent)' }}
                          >
                            #{p.orderId.slice(-8).toUpperCase()}
                          </Link>
                        </td>
                        <td
                          className="px-4 py-3 font-medium"
                          style={{ color: 'var(--color-destructive)' }}
                        >
                          ₺{amount.toLocaleString('tr-TR')}
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                          {p.reason}
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                          {new Date(p.createdAt).toLocaleDateString('tr-TR', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={p.status as never} />
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
