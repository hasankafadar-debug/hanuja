import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@hanuja/ui'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { isMissingDatabaseObjectError } from '@hanuja/api/lib/prisma-runtime'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { getAdminSession } from '@/lib/admin-session'
import { AdminActions } from '../_components/admin-actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ek Sure Talebi Detay' }

export default async function UzatmaTalebiDetay({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await getAdminSession()
  const { id } = await params
  const prisma = createPrismaForRoute()

  let schemaReady = true
  let request:
    | {
        id: string
        requestedDays: number
        approvedDays: number | null
        sellerReason: string
        adminNote: string | null
        customerQuestionFromAdmin: string | null
        customerResponseNote: string | null
        customerRespondedAt: Date | null
        customerResponseIp: string | null
        customerResponseSessionId: string | null
        createdAt: Date
        status: string
        order: {
          id: string
          publicNumber: number | null
          status: string
          paymentConfirmedAt: Date | null
          deliveryConfirmedAt: Date | null
        }
        seller: { id: string; displayName: string } | null
        customer: { id: string; name: string | null; email: string } | null
      }
    | null = null

  try {
    request = await prisma.fulfillmentExtensionRequest.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            publicNumber: true,
            status: true,
            paymentConfirmedAt: true,
            deliveryConfirmedAt: true,
          },
        },
        seller: { select: { id: true, displayName: true } },
        customer: { select: { id: true, name: true, email: true } },
      },
    })
  } catch (error) {
    if (
      isMissingDatabaseObjectError(error, {
        tableNames: ['fulfillment_extension_requests'],
      })
    ) {
      schemaReady = false
      console.warn(
        '[admin] fulfillment_extension_requests tablosu hazir degil; extension detay sayfasi bekleme modunda.',
      )
    } else {
      throw error
    }
  }

  if (schemaReady && !request) return notFound()

  if (!schemaReady) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Ek Sure Talebi Detay"
          description="Bu kayit su anda goruntulenemiyor."
        />
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: '#f59e0b', backgroundColor: '#fffbeb', color: '#92400e' }}
        >
          Ek sure talebi bilgilerine su anda ulasilamiyor. Lutfen biraz sonra tekrar deneyin.
        </div>
      </div>
    )
  }

  const extensionRequest = request!
  const terminal = ['approved', 'rejected_by_admin', 'rejected_by_customer'].includes(
    extensionRequest.status,
  )

  return (
    <div className="space-y-6">
        <PageHeader
        title={`Ek Sure Talebi #${extensionRequest.id.slice(-8).toUpperCase()}`}
        description={`Siparis ${formatOrderDisplayNumber(extensionRequest.order.publicNumber, extensionRequest.order.id)}`}
      />

      <div className="grid grid-cols-2 gap-4">
        <Card label="Siparis">
          <Link
            href={`/siparisler/${extensionRequest.order.id}`}
            className="hover:underline"
            style={{ color: 'var(--color-accent)' }}
          >
            {formatOrderDisplayNumber(extensionRequest.order.publicNumber, extensionRequest.order.id)}
          </Link>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Durum: {extensionRequest.order.status}
          </p>
        </Card>

        <Card label="Satici">
          {extensionRequest.seller ? (
            <Link
              href={`/saticilar/${extensionRequest.seller.id}`}
              className="hover:underline"
              style={{ color: 'var(--color-accent)' }}
            >
              {extensionRequest.seller.displayName}
            </Link>
          ) : (
            '-'
          )}
        </Card>

        <Card label="Musteri">
          <span>{extensionRequest.customer?.name ?? '-'}</span>
        </Card>

        <Card label="Talep">
          <p>
            <strong>{extensionRequest.requestedDays} gun</strong>
            {extensionRequest.approvedDays !== null
              ? ` - Onaylanan: ${extensionRequest.approvedDays} gun`
              : ''}
          </p>
        </Card>

        <Card label="Talep Tarihi" full>
          <p>{new Date(extensionRequest.createdAt).toLocaleString('tr-TR')}</p>
        </Card>

        <Card label="Satici Gerekcesi" full>
          <p className="whitespace-pre-wrap">{extensionRequest.sellerReason}</p>
        </Card>

        {extensionRequest.adminNote ? (
          <Card label="Admin Notu" full>
            <p className="whitespace-pre-wrap">{extensionRequest.adminNote}</p>
          </Card>
        ) : null}

        {extensionRequest.customerQuestionFromAdmin ? (
          <Card label="Musteriye Yoneltilen Soru" full>
            <p className="whitespace-pre-wrap">{extensionRequest.customerQuestionFromAdmin}</p>
          </Card>
        ) : null}

        {extensionRequest.customerResponseNote || extensionRequest.customerRespondedAt ? (
          <Card label="Musteri Yaniti" full>
            <p className="whitespace-pre-wrap">{extensionRequest.customerResponseNote ?? '-'}</p>
            {extensionRequest.customerRespondedAt ? (
              <p className="mt-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                Tarih: {new Date(extensionRequest.customerRespondedAt).toLocaleString('tr-TR')}
                {extensionRequest.customerResponseIp
                  ? ` - IP: ${extensionRequest.customerResponseIp}`
                  : ''}
                {extensionRequest.customerResponseSessionId
                  ? ` - Session: ${extensionRequest.customerResponseSessionId.slice(-8)}`
                  : ''}
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>

      {!terminal ? (
        <AdminActions
          requestId={extensionRequest.id}
          requestedDays={extensionRequest.requestedDays}
        />
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Bu talep sonuclanmis. Yeni aksiyon alinamaz.
        </p>
      )}
    </div>
  )
}

function Card({
  label,
  children,
  full,
}: {
  label: string
  children: React.ReactNode
  full?: boolean
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${full ? 'col-span-2' : ''}`}
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <p
        className="mb-1 text-xs font-medium uppercase tracking-wide"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        {label}
      </p>
      <div style={{ color: 'var(--color-primary)' }}>{children}</div>
    </div>
  )
}
