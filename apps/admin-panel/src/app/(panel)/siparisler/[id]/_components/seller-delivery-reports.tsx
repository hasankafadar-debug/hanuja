type ReportedLine = {
  id: string
  sellerId: string
  productName: string
  quantity: number
  cancelledQuantity: number
  sellerDeliveryReportedAt: Date | null
  deliveryConfirmedAt: Date | null
  seller: { displayName: string }
}
type Shipment = {
  sellerId: string
  cargoProvider: string
  trackingNumber: string | null
}

export function SellerDeliveryReports({
  lines,
  shipments,
}: {
  lines: ReportedLine[]
  shipments: Shipment[]
}) {
  const groups = new Map<string, ReportedLine[]>()
  for (const line of lines) {
    if (!line.sellerDeliveryReportedAt) continue
    const group = groups.get(line.sellerId) ?? []
    group.push(line)
    groups.set(line.sellerId, group)
  }
  if (groups.size === 0) return null
  const format = (date: Date) => date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
  return (
    <section
      className="rounded-xl border p-5"
      data-testid="seller-delivery-reports"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <h2 className="mb-1 font-semibold" style={{ color: 'var(--color-primary)' }}>
        Satıcı Teslim Bildirimleri
      </h2>
      <p className="mb-4 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Satıcının bildirimi teslim teyidi değildir. Müşteriye ulaştığını kontrol edip ürünleri
        onaylayın.
      </p>
      {[...groups].map(([sellerId, reportedLines]) => {
        const shipment = shipments.find((item) => item.sellerId === sellerId)
        return (
          <div
            key={sellerId}
            className="mt-4 border-t pt-3"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
              {reportedLines[0]!.seller.displayName}
            </h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Kargo: {shipment?.cargoProvider ?? '—'} · Takip no: {shipment?.trackingNumber ?? '—'}
            </p>
            <ul className="mt-3 space-y-3 text-sm">
              {reportedLines.map((line) => (
                <li key={line.id}>
                  <p style={{ color: 'var(--color-primary)' }}>
                    {line.productName} × {line.quantity - line.cancelledQuantity}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    Satıcı bildirimi:{' '}
                    <time dateTime={line.sellerDeliveryReportedAt!.toISOString()}>
                      {format(line.sellerDeliveryReportedAt!)}
                    </time>
                  </p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {line.deliveryConfirmedAt ? (
                      <>
                        Teslim teyidi:{' '}
                        <time dateTime={line.deliveryConfirmedAt.toISOString()}>
                          {format(line.deliveryConfirmedAt)}
                        </time>
                      </>
                    ) : (
                      'Admin teslim teyidi bekleniyor'
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
