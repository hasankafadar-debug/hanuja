export const TEST_EMAIL = 'playwright-eft@hanuja.test'
export const TEST_PASSWORD = 'PlaywrightEFT1234!'
export const TEST_NAME = 'Playwright Musteri'

export const CUSTOMER_FIXTURE = {
  productSlug: 'masif-mese-orta-sehpa-dogal',
  storeSlug: 'atelier-noa',
  couponCode: 'PLAYWRIGHT10',
  supportReplyBody: 'Merhaba, bu destek talebini musteri tarafindan tekrar guncelliyorum.',
  returnReplyBody: 'Iade sureci icin ek bilgi paylasiyorum.',
  reviewTitle: 'Playwright denemesi',
  reviewBody: 'Urun beklentimi karsiladi, teslimat ve paketleme de duzenliydi.',
  ids: {
    shippingAddress: 'pw_addr_shipping',
    billingAddress: 'pw_addr_billing',
    coupon: 'pw_coupon_playwright_10',
    orders: {
      cancelable: 'pw_order_cancelable',
      returnEligible: 'pw_order_return_eligible',
      activeReturn: 'pw_order_active_return',
      supportOpen: 'pw_order_support_open',
      invoiceReview: 'pw_order_invoice_review',
    },
    legalSnapshots: {
      cancelable: 'pw_legal_cancelable',
      returnEligible: 'pw_legal_return_eligible',
      activeReturn: 'pw_legal_active_return',
      supportOpen: 'pw_legal_support_open',
      invoiceReview: 'pw_legal_invoice_review',
    },
    orderLines: {
      cancelable: 'pw_line_cancelable',
      returnEligible: 'pw_line_return_eligible',
      activeReturn: 'pw_line_active_return',
      supportOpen: 'pw_line_support_open',
      invoiceReview: 'pw_line_invoice_review',
    },
    payments: {
      cancelable: 'pw_payment_cancelable',
      returnEligible: 'pw_payment_return_eligible',
      activeReturn: 'pw_payment_active_return',
      supportOpen: 'pw_payment_support_open',
      invoiceReview: 'pw_payment_invoice_review',
    },
    shipments: {
      returnEligible: 'pw_shipment_return_eligible',
      activeReturn: 'pw_shipment_active_return',
      supportOpen: 'pw_shipment_support_open',
      invoiceReview: 'pw_shipment_invoice_review',
    },
    returnRequests: {
      active: 'pw_return_active',
    },
    returnMessages: {
      activeSeller: 'pw_return_msg_active_seller',
    },
    supportTickets: {
      open: 'pw_support_ticket_open',
    },
    supportMessages: {
      openInitial: 'pw_support_msg_open_initial',
    },
    extensionRequest: 'pw_extension_request',
    invoice: 'pw_order_invoice',
  },
} as const

export interface CustomerFixtureState {
  generatedAt: string
  productSlug: string
  storeSlug: string
  couponCode: string
  invoiceFixtureAvailable: boolean
  invoiceFixtureError: string | null
  orderIds: typeof CUSTOMER_FIXTURE.ids.orders
  supportTicketIds: typeof CUSTOMER_FIXTURE.ids.supportTickets
  returnRequestIds: typeof CUSTOMER_FIXTURE.ids.returnRequests
  extensionRequestId: string
}
