/**
 * Pure, serialisable inputs shared by transactional e-mail templates.
 *
 * These types intentionally do not import Prisma, framework, or transport
 * code. Callers prepare the values (including the display-formatted amounts)
 * and the templates only render them.
 */

export type EmailAmount = string | number

export interface EmailTemplate {
  subject: string
  html: string
  text: string
}

/**
 * A line shown in an order e-mail. `unitPrice` and `lineTotal` are the
 * customer-facing purchase amounts. `variantName` is omitted for products
 * without a selected variant.
 */
export interface EmailOrderLine {
  productName: string
  sellerId?: string
  variantName?: string | null
  quantity: number
  unitPrice: EmailAmount
  lineTotal: EmailAmount
}

/**
 * Legacy line shape used by the original order confirmation payload. It is
 * kept as a separate pure type so old callers can continue to render while
 * new event payloads use EmailOrderLine.
 */
export interface LegacyEmailOrderLine {
  name: string
  sellerId?: string
  quantity: number
  price: EmailAmount
  variantName?: string | null
  lineTotal?: EmailAmount
}

/**
 * Compatibility shape for event payloads whose producer uses shorter field
 * names (`product`, `variant`, or `unitPurchasePrice`).
 */
export interface FlexibleEmailOrderLine {
  productName?: string
  product?: string
  name?: string
  sellerId?: string
  variantName?: string | null
  variant?: string | null
  quantity: number
  unitPrice?: EmailAmount
  unitPurchasePrice?: EmailAmount
  price?: EmailAmount
  lineTotal?: EmailAmount
}

export type EmailOrderLineInput = EmailOrderLine | LegacyEmailOrderLine | FlexibleEmailOrderLine

export interface CustomerOrderEmailInput {
  customerName: string
  orderNumber: string
  items: readonly EmailOrderLineInput[]
  /** Customer storefront order-detail URL. */
  orderUrl?: string
  /** Alias used by callers that name the destination explicitly. */
  customerOrderUrl?: string
  orderLink?: string
  totalAmount?: EmailAmount
}

export interface CustomerPaymentConfirmedEmailInput extends CustomerOrderEmailInput {
  paymentMethod?: 'card' | 'eft'
}

export interface CustomerShipmentEmailInput extends Omit<CustomerOrderEmailInput, 'items'> {
  /** Older shipment events did not carry line details. */
  items?: readonly EmailOrderLineInput[]
  trackingNumber?: string
  cargoCompany?: string
}

export interface SellerOrderEmailInput {
  sellerName: string
  orderNumber: string
  sellerId?: string
  /** Only this seller's lines may be supplied by the caller. */
  items: readonly EmailOrderLineInput[]
  /** Seller-panel order-detail URL. */
  panelUrl?: string
  /** Alias used by callers that name the destination explicitly. */
  sellerPanelUrl?: string
  panelLink?: string
  /** Backward-compatible alias accepted by generic order callers. */
  orderUrl?: string
  totalAmount?: EmailAmount
}

export interface SellerCancellationEmailInput extends SellerOrderEmailInput {
  cancellationReason?: string
}

export interface SellerReturnRequestEmailInput extends SellerOrderEmailInput {
  returnReason?: string
}

export interface SellerRefundCompletedEmailInput extends SellerOrderEmailInput {
  refundAmount?: EmailAmount
}

export interface CustomerReturnRequestEmailInput extends Omit<CustomerOrderEmailInput, 'items'> {
  /** Older return events only carried the reason and order number. */
  items?: readonly EmailOrderLineInput[]
  returnReason?: string
}

export interface CustomerRefundCompletedEmailInput extends Omit<CustomerOrderEmailInput, 'items'> {
  items?: readonly EmailOrderLineInput[]
  refundAmount?: EmailAmount
}
