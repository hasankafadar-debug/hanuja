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
  /** Absolute https product image URL; omitted/null renders an empty image cell. */
  imageUrl?: string | null
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
  imageUrl?: string | null
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
  imageUrl?: string | null
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
  /** Verified https carrier tracking page; omitted when the carrier is unknown. */
  trackingUrl?: string | null
  sellerName?: string
}

export interface BankTransferInstruction {
  bankName: string
  accountHolder: string
  iban: string
  reference?: string
  branchName?: string | null
  accountHolderNote?: string | null
  missing?: boolean
}

/** Optional money breakdown shown under the line table. Values are display-formatted. */
export interface OrderAmountSummary {
  subtotal?: EmailAmount
  couponCode?: string | null
  couponDiscount?: EmailAmount
  eftDiscount?: EmailAmount
  eftDiscountRate?: string | null
  additionalDiscount?: EmailAmount
  shipping?: EmailAmount
}

export interface OrderContractLinks {
  distanceSalesUrl?: string | null
  preInformationUrl?: string | null
}

export interface CustomerOrderConfirmationEmailInput extends CustomerOrderEmailInput {
  totalAmount: EmailAmount
  paymentMethod: 'card' | 'eft'
  /** Card orders are only mailed after confirmation; EFT orders while payment is pending. */
  paymentStatus?: 'confirmed' | 'pending'
  bankTransferInstructions?: BankTransferInstruction | readonly BankTransferInstruction[]
  summary?: OrderAmountSummary
  contracts?: OrderContractLinks
}

export interface CustomerDeliveryConfirmedEmailInput extends CustomerOrderEmailInput {
  /** True when only some lines of the order were confirmed in this event. */
  partial: boolean
  /** Display-formatted confirmation date (tr-TR). */
  confirmedAt?: string
}

export interface CustomerInvoiceEmailInput {
  customerName: string
  orderNumber: string
  orderUrl?: string
  invoiceUrl?: string | null
  sellerName?: string
  items?: readonly EmailOrderLineInput[]
}

export type CancellationActorRole = 'customer' | 'seller' | 'admin' | 'system' | 'payment_failure'

export interface CustomerCancellationEmailInput extends CustomerOrderEmailInput {
  partial: boolean
  actorRole: CancellationActorRole
  reason?: string | null
  /** Amount to be refunded to the customer (product + shipping share); omitted when nothing was collected. */
  refundAmount?: EmailAmount
  paymentMethod?: 'card' | 'eft' | null
}

export interface CustomerReturnCargoInfoEmailInput extends Omit<CustomerOrderEmailInput, 'items'> {
  items?: readonly EmailOrderLineInput[]
  cargoAddress?: string | null
  cargoCarrier?: string | null
  cargoInstructions?: string | null
}

export interface ReturnDecisionLine extends EmailOrderLine {
  acceptedQuantity: number
  rejectedQuantity: number
  rejectionReason?: string | null
}

export type ReturnDecision = 'approved' | 'partial' | 'rejected'

export interface CustomerReturnDecisionEmailInput {
  customerName: string
  orderNumber: string
  orderUrl?: string
  decision: ReturnDecision
  items: readonly ReturnDecisionLine[]
  refundAmount?: EmailAmount
  /** A rejection automatically opened a dispute the customer can reply to. */
  disputeOpened?: boolean
  reviewNote?: string | null
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
  actorRole?: CancellationActorRole
  partial?: boolean
}

export interface SellerReturnRequestEmailInput extends SellerOrderEmailInput {
  returnReason?: string
}

export interface CustomerReturnRequestEmailInput extends Omit<CustomerOrderEmailInput, 'items'> {
  /** Older return events only carried the reason and order number. */
  items?: readonly EmailOrderLineInput[]
  returnReason?: string
}

export interface CustomerRefundCompletedEmailInput extends Omit<CustomerOrderEmailInput, 'items'> {
  items?: readonly EmailOrderLineInput[]
  refundAmount?: EmailAmount
  paymentMethod?: 'card' | 'eft' | null
}
