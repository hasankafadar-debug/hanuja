/**
 * Producer-side helper: turns persisted order lines into the serialisable
 * `EmailOrderLine` shape used by e-mail templates (formatted amounts, absolute
 * https product image URL). Keeps every notification producer consistent.
 */
import type { Decimal } from '@prisma/client/runtime/client'
import { formatMoney } from '@hanuja/security/money'
import type { EmailOrderLine } from './email-templates/types'
import { buildManagedMediaShareUrl } from './media-url'
import { getWebBaseUrl } from './platform-info'

export interface EmailLineSource {
  productName: string
  variantName?: string | null
  sellerId?: string | null
  unitPrice: Decimal | number | string
  product?: {
    images?: ReadonlyArray<{ url: string; isPrimary?: boolean; sortOrder?: number }>
  } | null
}

/** Prisma include fragment producers attach to order lines for e-mail rendering. */
export const EMAIL_LINE_IMAGE_SELECT = {
  images: {
    orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
    take: 1,
    select: { url: true, isPrimary: true, sortOrder: true },
  },
}

function toNumber(value: Decimal | number | string): number {
  return typeof value === 'number' ? value : Number(value.toString())
}

/**
 * Absolute product image URL for e-mail clients. Managed media resolves to the
 * public media host (or the storefront proxy when that host is not configured);
 * relative or empty values yield null so the template renders an empty cell.
 */
export function resolveEmailImageUrl(
  images: ReadonlyArray<{ url: string; isPrimary?: boolean; sortOrder?: number }> | null | undefined,
): string | null {
  const sorted = [...(images ?? [])].sort(
    (a, b) =>
      Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  )
  const url = sorted[0]?.url?.trim()
  if (!url) return null
  const shared = buildManagedMediaShareUrl(url, { proxyBaseUrl: getWebBaseUrl() })
  return shared && /^https?:\/\//.test(shared) ? shared : null
}

/**
 * Build one e-mail line. `quantity` is the quantity relevant to the event (shipped,
 * cancelled, returned…) — never the original order quantity by default — and
 * `lineTotal` defaults to unitPrice × quantity for that event quantity.
 */
export function toEmailOrderLine(
  line: EmailLineSource,
  quantity: number,
  options: { lineTotal?: Decimal | number | string } = {},
): EmailOrderLine {
  const unitPrice = toNumber(line.unitPrice)
  const lineTotal =
    options.lineTotal !== undefined ? toNumber(options.lineTotal) : unitPrice * quantity
  return {
    productName: line.productName,
    variantName: line.variantName ?? null,
    ...(line.sellerId ? { sellerId: line.sellerId } : {}),
    quantity,
    unitPrice: formatMoney(unitPrice),
    lineTotal: formatMoney(lineTotal),
    imageUrl: resolveEmailImageUrl(line.product?.images),
  }
}
