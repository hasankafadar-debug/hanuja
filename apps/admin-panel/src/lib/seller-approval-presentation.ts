type SellerLine = {
  seller: { id: string; displayName?: string | null; profile?: { companyName?: string | null } | null } | null
}

export function pendingSellerNames(lines: SellerLine[], sellerIds: string[]): string {
  return [...new Set(sellerIds)].map((id) => {
    const seller = lines.find((line) => line.seller?.id === id)?.seller
    return seller?.displayName || seller?.profile?.companyName || id
  }).join(', ') || '-'
}

export function formatApprovalWait(waitingSince: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(waitingSince).getTime()) / 60_000))
  return `${Math.floor(minutes / 60)} saat ${minutes % 60} dakika`
}

export function formatPaymentConfirmedAt(value: Date | null | undefined): string {
  return value ? new Date(value).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '-'
}
