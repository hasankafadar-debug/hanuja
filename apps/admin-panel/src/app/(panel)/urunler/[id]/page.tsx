import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge, PageHeader, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { ProductModerationActions } from '@/components/product-moderation-actions'
import { buildSuggestedRejectReason, parseModerationFindings } from '@/lib/product-moderation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ürün Moderasyon Detayı' }

const STATUS_MAP: Record<string, { label: string; variant: 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  pending_review: { label: 'İnceleme bekliyor', variant: 'warning' },
  published: { label: 'Yayında', variant: 'success' },
  rejected: { label: 'Reddedildi', variant: 'destructive' },
  draft: { label: 'Taslak', variant: 'secondary' },
  unlisted: { label: 'Yayından kaldırıldı', variant: 'secondary' },
}

export default async function AdminProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await getAdminSession()

  const { id } = await params
  const prisma = createPrismaForRoute()
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
      seller: {
        select: {
          id: true,
          displayName: true,
          profile: { select: { city: true } },
        },
      },
      category: { select: { id: true, name: true } },
    },
  })

  if (!product) notFound()

  const statusInfo = STATUS_MAP[product.status] ?? { label: product.status, variant: 'secondary' as const }
  const findings = parseModerationFindings(product.moderationFindings)
  const suggestedRejectReason = buildSuggestedRejectReason(findings)

  return (
    <div className="space-y-8">
      <PageHeader
        title={product.name}
        description={`${product.seller?.displayName ?? 'Satıcı yok'} • ${product.category?.name ?? 'Kategori yok'}`}
      />

      <div className="grid gap-8 lg:grid-cols-[1.4fr_0.9fr]">
        <section className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {product.images.length === 0 ? (
              <div
                className="flex aspect-square items-center justify-center rounded-lg border text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
              >
                Görsel yok
              </div>
            ) : (
              product.images.map((image) => (
                <img
                  key={image.id}
                  src={normalizeMediaDisplayUrl(image.url)}
                  alt={image.altText ?? product.name}
                  className="aspect-square w-full rounded-lg border object-cover"
                  style={{ borderColor: 'var(--color-border)' }}
                />
              ))
            )}
          </div>

          <div className="space-y-4 rounded-xl border p-5" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              <span className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                {product.createdAt.toLocaleDateString('tr-TR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </div>

            {product.rejectionReason && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <strong>Ret nedeni:</strong> {product.rejectionReason}
              </div>
            )}

            <Field label="Kısa açıklama" value={product.shortDescription} />
            <Field label="Açıklama" value={product.description} multiline />
            <Field label="Ürün hikayesi" value={product.story} multiline />
            <Field label="Bakım talimatı" value={product.careInstructions} multiline />
          </div>

          <div className="space-y-4 rounded-xl border p-5" style={{ borderColor: 'var(--color-border)' }}>
            <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Moderasyon Bulguları</h2>
            {findings.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Bu ürün için kaydedilmiş bir moderasyon bulgusu yok.
              </p>
            ) : (
              <div className="space-y-3">
                {findings.map((finding, index) => (
                  <div
                    key={`${finding.type}-${finding.field}-${index}`}
                    className="rounded-lg border p-4"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{finding.field}</Badge>
                      <Badge variant="secondary">{finding.type}</Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      {finding.reason}
                    </p>
                    <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                      <code>{finding.match}</code>
                    </p>
                    <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                      {finding.excerpt}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)' }}>
            <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Ürün Özeti</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <MetaRow label="Satıcı" value={product.seller?.displayName ?? '—'} />
              <MetaRow label="Şehir" value={product.seller?.profile?.city ?? '—'} />
              <MetaRow label="Kategori" value={product.category?.name ?? '—'} />
              <MetaRow label="Fiyat" value={`₺${product.price.toNumber().toLocaleString('tr-TR')}`} />
              <MetaRow label="Stok" value={String(product.stockQuantity)} />
              <MetaRow label="SKU" value={product.sku ?? '—'} />
              <MetaRow label="Barkod" value={product.barcode ?? '—'} />
            </dl>
          </div>

          {product.status === 'pending_review' && (
            <div className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)' }}>
              <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Moderasyon Kararı</h2>
              <p className="mt-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Bulgular satıcıya gösterilecek ret metni için başlangıç noktası sağlar.
              </p>
              <div className="mt-4">
                <ProductModerationActions
                  productId={product.id}
                  defaultRejectReason={suggestedRejectReason}
                />
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function Field({ label, value, multiline = false }: { label: string; value?: string | null; multiline?: boolean }) {
  return (
    <div>
      <h3 className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>{label}</h3>
      <p
        className={multiline ? 'mt-1 whitespace-pre-wrap text-sm' : 'mt-1 text-sm'}
        style={{ color: 'var(--color-muted-fg)' }}
      >
        {value?.trim() || '—'}
      </p>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt style={{ color: 'var(--color-muted-fg)' }}>{label}</dt>
      <dd className="text-right font-medium" style={{ color: 'var(--color-primary)' }}>{value}</dd>
    </div>
  )
}
