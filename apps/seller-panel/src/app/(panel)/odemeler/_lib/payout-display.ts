/**
 * Satıcı hakediş (payout) ekranlarında durum ve bloke süresi gösterim
 * yardımcıları. Liste ve detay sayfası aynı kuralı paylaşsın diye burada
 * merkezileştirildi (02-coding-standards — tekrar azaltma).
 *
 * Bu dosya SADECE sunum/etiket üretir; finans hesabı yapmaz. Tutarlar her zaman
 * backend snapshot'ından gelir. Bloke süresi bir tarih aritmetiğidir (kalan
 * gün) — para değeri değildir.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24

export interface PayoutStatusDisplay {
  /** StatusBadge'e verilecek status — doğru renk varyantını seçmek için normalize edilir. */
  badgeStatus: string
  /** StatusBadge label override'ı. */
  label: string
}

/**
 * Payout durumunu satıcıya gösterilecek üç sadeleştirilmiş duruma indirger.
 * Bloke durumu KURAL GEREĞİ gizlenemez (09-seller-panel-rules — payout
 * blocked reason görünür olmalı).
 */
export function payoutStatusDisplay(status: string): PayoutStatusDisplay {
  if (status === 'payout_paid') return { badgeStatus: 'payout_paid', label: 'Tamamlandı' }
  if (status === 'payout_blocked') return { badgeStatus: 'payout_blocked', label: 'Bloke' }
  // hold_active, payout_ready, payout_scheduled → hepsi "Bekliyor" (warning)
  return { badgeStatus: 'hold_active', label: 'Bekliyor' }
}

/**
 * Bloke bitişine kalan tam gün (bugünden, yukarı yuvarlama). Geçmişse "Doldu",
 * holdUntil yoksa "-".
 */
export function holdDaysRemainingLabel(holdUntil: Date | string | null, now = new Date()): string {
  if (!holdUntil) return '-'
  const target = new Date(holdUntil).getTime()
  if (Number.isNaN(target)) return '-'
  const diffMs = target - now.getTime()
  if (diffMs <= 0) return 'Doldu'
  return String(Math.ceil(diffMs / MS_PER_DAY))
}

/** tr-TR gg.aa.yyyy tarih biçimi; geçersiz/boş değerde "-". */
export function formatTrDate(value: Date | string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
