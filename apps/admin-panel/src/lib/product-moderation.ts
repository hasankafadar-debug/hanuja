export interface ProductModerationFinding {
  type: string
  field: string
  match: string
  excerpt: string
  reason: string
}

export function parseModerationFindings(input: unknown): ProductModerationFinding[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as Record<string, unknown>).type !== 'string' ||
      typeof (item as Record<string, unknown>).field !== 'string' ||
      typeof (item as Record<string, unknown>).match !== 'string' ||
      typeof (item as Record<string, unknown>).excerpt !== 'string' ||
      typeof (item as Record<string, unknown>).reason !== 'string'
    ) {
      return []
    }

    return [item as ProductModerationFinding]
  })
}

export function buildSuggestedRejectReason(findings: ProductModerationFinding[]) {
  if (findings.length === 0) {
    return 'Ürün metninde platform dışı iletişim veya yönlendirme tespit edildi. Lütfen iletişim bilgilerini kaldırıp yeniden gönderin.'
  }

  const labels = Array.from(new Set(findings.map((finding) => finding.reason.toLowerCase())))
  return `Ürün açıklamasında ${labels.join(', ')} tespit edildi. Lütfen iletişim veya yönlendirme bilgilerini kaldırıp yeniden gönderin.`
}
