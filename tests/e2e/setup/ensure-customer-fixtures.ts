import { PrismaClient, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CUSTOMER_FIXTURE,
  TEST_EMAIL,
  TEST_NAME,
  type CustomerFixtureState,
} from './customer-fixture-data'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '../../..')
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright')
const STATE_PATH = path.join(OUTPUT_DIR, 'customer-fixture-state.json')

const DISTANCE_SALES_HTML =
  '<h1>Mesafeli Satis Sozlesmesi</h1><p>Playwright musterisi icin fixture metnidir.</p>'
const PRE_INFORMATION_HTML =
  '<h1>On Bilgilendirme Formu</h1><p>Playwright musterisi icin fixture metnidir.</p>'
function daysAgo(days: number, hour = 10) {
  const now = new Date()
  now.setHours(hour, 0, 0, 0)
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
}

async function cleanupFixtureGraph(
  prisma: PrismaClient,
  params: {
    orderIds: string[]
    paymentIds: string[]
    shipmentIds: string[]
    supportTicketIds: string[]
    supportMessageIds: string[]
    returnRequestIds: string[]
    returnMessageIds: string[]
    invoiceId: string
    customerId: string
    productId: string
    sellerId: string
  },
) {
  const existingInvoice = await prisma.orderSellerInvoice.findUnique({
    where: { id: params.invoiceId },
    select: { fileKey: true },
  })

  await prisma.customerSupportMessageAttachment.deleteMany({
    where: { messageId: { in: params.supportMessageIds } },
  })
  await prisma.customerSupportMessage.deleteMany({
    where: { id: { in: params.supportMessageIds } },
  })
  await prisma.customerSupportTicket.deleteMany({
    where: { id: { in: params.supportTicketIds } },
  })

  await prisma.returnMessage.deleteMany({
    where: { id: { in: params.returnMessageIds } },
  })
  await prisma.returnRequest.deleteMany({
    where: { id: { in: params.returnRequestIds } },
  })

  await prisma.fulfillmentExtensionRequest.deleteMany({
    where: { id: CUSTOMER_FIXTURE.ids.extensionRequest },
  })
  await prisma.productReview.deleteMany({
    where: { customerId: params.customerId, productId: params.productId },
  })
  await prisma.orderSellerInvoice.deleteMany({
    where: { id: params.invoiceId },
  })
  await prisma.orderEmailAlias.deleteMany({
    where: { orderId: { in: params.orderIds } },
  })
  await prisma.inboundEmail.deleteMany({
    where: { orderId: { in: params.orderIds } },
  })
  await prisma.orderLegalSnapshot.deleteMany({
    where: { orderId: { in: params.orderIds } },
  })
  await prisma.shipmentEvent.deleteMany({
    where: { shipmentId: { in: params.shipmentIds } },
  })
  await prisma.shipment.deleteMany({
    where: { id: { in: params.shipmentIds } },
  })
  await prisma.paymentEvent.deleteMany({
    where: { paymentId: { in: params.paymentIds } },
  })
  await prisma.payment.deleteMany({
    where: { id: { in: params.paymentIds } },
  })
  await prisma.orderStatusHistory.deleteMany({
    where: { orderId: { in: params.orderIds } },
  })
  await prisma.orderLine.deleteMany({
    where: { orderId: { in: params.orderIds } },
  })
  await prisma.couponUsage.deleteMany({
    where: { orderId: { in: params.orderIds } },
  })
  await prisma.order.deleteMany({
    where: { id: { in: params.orderIds } },
  })
  await prisma.favoriteProduct.deleteMany({
    where: { userId: params.customerId, productId: params.productId },
  })
  await prisma.storeFollow.deleteMany({
    where: { userId: params.customerId, sellerId: params.sellerId },
  })
  await prisma.cart.updateMany({
    where: { userId: params.customerId },
    data: { couponCode: null },
  })
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: params.customerId } },
  })

  void existingInvoice
}

async function createOrderFixture(
  prisma: PrismaClient,
  params: {
    orderId: string
    lineId: string
    paymentId: string
    legalSnapshotId: string
    customerId: string
    addressId: string
    billingAddressId: string
    productId: string
    productName: string
    productPrice: number
    productFulfillmentDays: number
    sellerId: string
    status: OrderStatus
    createdAt: Date
    paymentConfirmedAt?: Date
    sellerQueueReadyAt?: Date
    shippedAt?: Date
    deliveredAt?: Date
    deliveryConfirmedAt?: Date
  },
) {
  const order = await prisma.order.create({
    data: {
      id: params.orderId,
      customerId: params.customerId,
      addressId: params.addressId,
      billingAddressId: params.billingAddressId,
      status: params.status,
      grossAmount: params.productPrice,
      netSubtotal: params.productPrice,
      shippingAmount: 0,
      taxAmount: 0,
      totalAmount: params.productPrice,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
      ...(params.paymentConfirmedAt ? { paymentConfirmedAt: params.paymentConfirmedAt } : {}),
      ...(params.sellerQueueReadyAt ? { sellerQueueReadyAt: params.sellerQueueReadyAt } : {}),
      ...(params.shippedAt ? { shippedAt: params.shippedAt } : {}),
      ...(params.deliveredAt ? { deliveredAt: params.deliveredAt } : {}),
      ...(params.deliveryConfirmedAt ? { deliveryConfirmedAt: params.deliveryConfirmedAt } : {}),
    },
  })

  await prisma.orderLine.create({
    data: {
      id: params.lineId,
      orderId: params.orderId,
      productId: params.productId,
      sellerId: params.sellerId,
      productName: params.productName,
      quantity: 1,
      unitPrice: params.productPrice,
      totalPrice: params.productPrice,
      promisedFulfillmentDays: params.productFulfillmentDays,
      ...(params.deliveryConfirmedAt
        ? {
            deliveryConfirmedAt: params.deliveryConfirmedAt,
            deliveryConfirmedBy: 'system',
          }
        : {}),
    },
  })

  await prisma.payment.create({
    data: {
      id: params.paymentId,
      orderId: params.orderId,
      method: PaymentMethod.card,
      status: PaymentStatus.confirmed,
      amount: params.productPrice,
      confirmedAt: params.paymentConfirmedAt ?? params.createdAt,
    },
  })

  await prisma.orderLegalSnapshot.create({
    data: {
      id: params.legalSnapshotId,
      orderId: params.orderId,
      distanceSalesHtml: DISTANCE_SALES_HTML,
      preInformationHtml: PRE_INFORMATION_HTML,
      buyerSnapshot: {
        fullName: TEST_NAME,
        email: TEST_EMAIL,
      },
      sellerSnapshot: {
        sellerId: params.sellerId,
      },
      platformSnapshot: {
        platform: 'Hanuja',
      },
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    },
  })

  await prisma.orderStatusHistory.createMany({
    data: [
      {
        orderId: params.orderId,
        toStatus: OrderStatus.draft,
        createdAt: params.createdAt,
      },
      {
        orderId: params.orderId,
        fromStatus: OrderStatus.draft,
        toStatus: params.status,
        actorId: 'fixture',
        createdAt: new Date(params.createdAt.getTime() + 5 * 60 * 1000),
      },
    ],
  })

  return order
}

async function writeState(state: CustomerFixtureState) {
  await ensureOutputDir()
  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

async function main() {
  const prisma = new PrismaClient()

  const customer = await prisma.user.findFirst({
    where: { email: TEST_EMAIL },
    select: { id: true },
  })
  if (!customer) {
    throw new Error(
      'Test musteri bulunamadi. Once tests/e2e/setup/ensure-test-customer.ts calistirin.',
    )
  }

  const product = await prisma.product.findUnique({
    where: { slug: CUSTOMER_FIXTURE.productSlug },
    select: {
      id: true,
      name: true,
      price: true,
      fulfillmentDays: true,
      seller: {
        select: {
          id: true,
          slug: true,
          displayName: true,
        },
      },
    },
  })
  if (!product || product.seller.slug !== CUSTOMER_FIXTURE.storeSlug) {
    throw new Error(
      `Fixture urunu bulunamadi: ${CUSTOMER_FIXTURE.productSlug} / ${CUSTOMER_FIXTURE.storeSlug}`,
    )
  }

  const shippingAddress =
    (await prisma.address.findFirst({
      where: { userId: customer.id, isBillingAddress: false },
      select: { id: true },
    })) ??
    (await prisma.address.create({
      data: {
        id: CUSTOMER_FIXTURE.ids.shippingAddress,
        userId: customer.id,
        label: 'Ev',
        fullName: TEST_NAME,
        phone: '05001234567',
        addressLine1: 'Playwright Mahallesi, Test Sokak No:1',
        district: 'Kadikoy',
        city: 'Istanbul',
        postalCode: '34000',
        isDefault: true,
      },
      select: { id: true },
    }))

  await prisma.address.update({
    where: { id: shippingAddress.id },
    data: {
      label: 'Ev',
      fullName: TEST_NAME,
      phone: '05001234567',
      addressLine1: 'Playwright Mahallesi, Test Sokak No:1',
      district: 'Kadikoy',
      city: 'Istanbul',
      postalCode: '34000',
      isDefault: true,
      isBillingAddress: false,
    },
  })

  await prisma.address.upsert({
    where: { id: CUSTOMER_FIXTURE.ids.billingAddress },
    update: {
      userId: customer.id,
      label: 'Fatura',
      fullName: TEST_NAME,
      phone: '05001234567',
      addressLine1: 'Playwright Fatura Mahallesi, Vergi Sokak No:2',
      district: 'Besiktas',
      city: 'Istanbul',
      postalCode: '34353',
      isDefault: false,
      isBillingAddress: true,
      invoiceType: 'corporate',
      companyName: 'Playwright Test Hizmetleri Ltd. Sti.',
      taxOffice: 'Besiktas',
      taxNumber: '1234567890',
    },
    create: {
      id: CUSTOMER_FIXTURE.ids.billingAddress,
      userId: customer.id,
      label: 'Fatura',
      fullName: TEST_NAME,
      phone: '05001234567',
      addressLine1: 'Playwright Fatura Mahallesi, Vergi Sokak No:2',
      district: 'Besiktas',
      city: 'Istanbul',
      postalCode: '34353',
      isDefault: false,
      isBillingAddress: true,
      invoiceType: 'corporate',
      companyName: 'Playwright Test Hizmetleri Ltd. Sti.',
      taxOffice: 'Besiktas',
      taxNumber: '1234567890',
    },
  })

  const orderIds = Object.values(CUSTOMER_FIXTURE.ids.orders)
  const paymentIds = Object.values(CUSTOMER_FIXTURE.ids.payments)
  const shipmentIds = Object.values(CUSTOMER_FIXTURE.ids.shipments)
  const supportTicketIds = Object.values(CUSTOMER_FIXTURE.ids.supportTickets)
  const supportMessageIds = Object.values(CUSTOMER_FIXTURE.ids.supportMessages)
  const returnRequestIds = Object.values(CUSTOMER_FIXTURE.ids.returnRequests)
  const returnMessageIds = Object.values(CUSTOMER_FIXTURE.ids.returnMessages)

  await cleanupFixtureGraph(prisma, {
    orderIds,
    paymentIds,
    shipmentIds,
    supportTicketIds,
    supportMessageIds,
    returnRequestIds,
    returnMessageIds,
    invoiceId: CUSTOMER_FIXTURE.ids.invoice,
    customerId: customer.id,
    productId: product.id,
    sellerId: product.seller.id,
  })

  await prisma.coupon.upsert({
    where: { id: CUSTOMER_FIXTURE.ids.coupon },
    update: {
      code: CUSTOMER_FIXTURE.couponCode,
      discountType: 'percentage',
      discountValue: 10,
      minCartTotal: 100,
      maxUsagePerUser: 20,
      maxUsageTotal: 500,
      usageCount: 0,
      isActive: true,
    },
    create: {
      id: CUSTOMER_FIXTURE.ids.coupon,
      code: CUSTOMER_FIXTURE.couponCode,
      discountType: 'percentage',
      discountValue: 10,
      minCartTotal: 100,
      maxUsagePerUser: 20,
      maxUsageTotal: 500,
      usageCount: 0,
      isActive: true,
    },
  })

  const price = Number(product.price)
  const fulfillmentDays = product.fulfillmentDays
  const shippingAddressId = shippingAddress.id
  const billingAddressId = CUSTOMER_FIXTURE.ids.billingAddress

  await createOrderFixture(prisma, {
    orderId: CUSTOMER_FIXTURE.ids.orders.cancelable,
    lineId: CUSTOMER_FIXTURE.ids.orderLines.cancelable,
    paymentId: CUSTOMER_FIXTURE.ids.payments.cancelable,
    legalSnapshotId: CUSTOMER_FIXTURE.ids.legalSnapshots.cancelable,
    customerId: customer.id,
    addressId: shippingAddressId,
    billingAddressId,
    productId: product.id,
    productName: product.name,
    productPrice: price,
    productFulfillmentDays: fulfillmentDays,
    sellerId: product.seller.id,
    status: OrderStatus.seller_queue_ready,
    createdAt: daysAgo(2, 9),
    paymentConfirmedAt: daysAgo(2, 9),
    sellerQueueReadyAt: daysAgo(2, 10),
  })

  await prisma.fulfillmentExtensionRequest.create({
    data: {
      id: CUSTOMER_FIXTURE.ids.extensionRequest,
      orderId: CUSTOMER_FIXTURE.ids.orders.cancelable,
      sellerId: product.seller.id,
      customerId: customer.id,
      requestedDays: 4,
      sellerReason: 'Atolyede ek cila suresi gerekiyor.',
      status: 'awaiting_customer_decision',
      adminReviewedAt: daysAgo(1, 11),
      adminReviewedBy: 'user_admin_01',
      customerQuestionFromAdmin: 'Siparisinizi 4 is gunu daha beklemeyi kabul ediyor musunuz?',
      createdAt: daysAgo(1, 10),
      updatedAt: daysAgo(1, 11),
    },
  })

  await createOrderFixture(prisma, {
    orderId: CUSTOMER_FIXTURE.ids.orders.returnEligible,
    lineId: CUSTOMER_FIXTURE.ids.orderLines.returnEligible,
    paymentId: CUSTOMER_FIXTURE.ids.payments.returnEligible,
    legalSnapshotId: CUSTOMER_FIXTURE.ids.legalSnapshots.returnEligible,
    customerId: customer.id,
    addressId: shippingAddressId,
    billingAddressId,
    productId: product.id,
    productName: product.name,
    productPrice: price,
    productFulfillmentDays: fulfillmentDays,
    sellerId: product.seller.id,
    status: OrderStatus.delivery_confirmed,
    createdAt: daysAgo(8, 10),
    paymentConfirmedAt: daysAgo(8, 10),
    sellerQueueReadyAt: daysAgo(8, 11),
    shippedAt: daysAgo(7, 14),
    deliveredAt: daysAgo(6, 13),
    deliveryConfirmedAt: daysAgo(5, 12),
  })

  await prisma.shipment.create({
    data: {
      id: CUSTOMER_FIXTURE.ids.shipments.returnEligible,
      orderId: CUSTOMER_FIXTURE.ids.orders.returnEligible,
      sellerId: product.seller.id,
      cargoProvider: 'yurtici',
      trackingNumber: 'PWRETELIGIBLE001',
      status: 'delivered',
      handedAt: daysAgo(7, 14),
      deliveredAt: daysAgo(6, 13),
    },
  })

  await createOrderFixture(prisma, {
    orderId: CUSTOMER_FIXTURE.ids.orders.activeReturn,
    lineId: CUSTOMER_FIXTURE.ids.orderLines.activeReturn,
    paymentId: CUSTOMER_FIXTURE.ids.payments.activeReturn,
    legalSnapshotId: CUSTOMER_FIXTURE.ids.legalSnapshots.activeReturn,
    customerId: customer.id,
    addressId: shippingAddressId,
    billingAddressId,
    productId: product.id,
    productName: product.name,
    productPrice: price,
    productFulfillmentDays: fulfillmentDays,
    sellerId: product.seller.id,
    status: OrderStatus.return_approved,
    createdAt: daysAgo(9, 9),
    paymentConfirmedAt: daysAgo(9, 9),
    sellerQueueReadyAt: daysAgo(9, 10),
    shippedAt: daysAgo(8, 14),
    deliveredAt: daysAgo(7, 13),
    deliveryConfirmedAt: daysAgo(6, 12),
  })

  await prisma.shipment.create({
    data: {
      id: CUSTOMER_FIXTURE.ids.shipments.activeReturn,
      orderId: CUSTOMER_FIXTURE.ids.orders.activeReturn,
      sellerId: product.seller.id,
      cargoProvider: 'aras',
      trackingNumber: 'PWRETACTIVE001',
      status: 'delivered',
      handedAt: daysAgo(8, 14),
      deliveredAt: daysAgo(7, 13),
    },
  })

  await prisma.returnRequest.create({
    data: {
      id: CUSTOMER_FIXTURE.ids.returnRequests.active,
      orderId: CUSTOMER_FIXTURE.ids.orders.activeReturn,
      customerId: customer.id,
      status: 'approved',
      reason: 'Renk beklentimden farkli geldi.',
      description: 'Urunu iade etmek istiyorum.',
      isWithinWindow: true,
      sellerReturnAddress: 'Atolye Noa Iade Bolumu, Moda Cad. No:48 Kadikoy / Istanbul',
      sellerReturnCargoCarrier: 'Yurtici Kargo',
      sellerReturnInstructions: 'Paketin icine siparis numaranizi ekleyin.',
      sellerCargoInfoProvidedAt: daysAgo(2, 15),
      createdAt: daysAgo(2, 9),
      updatedAt: daysAgo(2, 15),
    },
  })

  await prisma.returnMessage.create({
    data: {
      id: CUSTOMER_FIXTURE.ids.returnMessages.activeSeller,
      returnRequestId: CUSTOMER_FIXTURE.ids.returnRequests.active,
      authorId: product.seller.id,
      authorRole: 'seller',
      body: 'Iade kargo bilgilerini paylastik, urunu bu adrese gonderebilirsiniz.',
      createdAt: daysAgo(2, 15),
    },
  })

  await createOrderFixture(prisma, {
    orderId: CUSTOMER_FIXTURE.ids.orders.supportOpen,
    lineId: CUSTOMER_FIXTURE.ids.orderLines.supportOpen,
    paymentId: CUSTOMER_FIXTURE.ids.payments.supportOpen,
    legalSnapshotId: CUSTOMER_FIXTURE.ids.legalSnapshots.supportOpen,
    customerId: customer.id,
    addressId: shippingAddressId,
    billingAddressId,
    productId: product.id,
    productName: product.name,
    productPrice: price,
    productFulfillmentDays: fulfillmentDays,
    sellerId: product.seller.id,
    status: OrderStatus.delivery_confirmed,
    createdAt: daysAgo(10, 10),
    paymentConfirmedAt: daysAgo(10, 10),
    sellerQueueReadyAt: daysAgo(10, 11),
    shippedAt: daysAgo(9, 14),
    deliveredAt: daysAgo(8, 13),
    deliveryConfirmedAt: daysAgo(7, 11),
  })

  await prisma.shipment.create({
    data: {
      id: CUSTOMER_FIXTURE.ids.shipments.supportOpen,
      orderId: CUSTOMER_FIXTURE.ids.orders.supportOpen,
      sellerId: product.seller.id,
      cargoProvider: 'mng',
      trackingNumber: 'PWSUPPORT001',
      status: 'delivered',
      handedAt: daysAgo(9, 14),
      deliveredAt: daysAgo(8, 13),
    },
  })

  await prisma.customerSupportTicket.create({
    data: {
      id: CUSTOMER_FIXTURE.ids.supportTickets.open,
      customerId: customer.id,
      orderId: CUSTOMER_FIXTURE.ids.orders.supportOpen,
      category: 'shipping_delay',
      subject: 'Siparis teslim sureciyle ilgili bilgi almak istiyorum.',
      status: 'waiting_for_admin',
      lastCustomerMessageAt: daysAgo(1, 16),
      createdAt: daysAgo(1, 16),
      updatedAt: daysAgo(1, 16),
    },
  })

  await prisma.customerSupportMessage.create({
    data: {
      id: CUSTOMER_FIXTURE.ids.supportMessages.openInitial,
      ticketId: CUSTOMER_FIXTURE.ids.supportTickets.open,
      authorId: customer.id,
      authorRole: 'customer',
      body: 'Merhaba, teslimat detaylarini teyit etmek icin destek istiyorum.',
      createdAt: daysAgo(1, 16),
    },
  })

  await createOrderFixture(prisma, {
    orderId: CUSTOMER_FIXTURE.ids.orders.invoiceReview,
    lineId: CUSTOMER_FIXTURE.ids.orderLines.invoiceReview,
    paymentId: CUSTOMER_FIXTURE.ids.payments.invoiceReview,
    legalSnapshotId: CUSTOMER_FIXTURE.ids.legalSnapshots.invoiceReview,
    customerId: customer.id,
    addressId: shippingAddressId,
    billingAddressId,
    productId: product.id,
    productName: product.name,
    productPrice: price,
    productFulfillmentDays: fulfillmentDays,
    sellerId: product.seller.id,
    status: OrderStatus.delivery_confirmed,
    createdAt: daysAgo(4, 10),
    paymentConfirmedAt: daysAgo(4, 10),
    sellerQueueReadyAt: daysAgo(4, 11),
    shippedAt: daysAgo(3, 14),
    deliveredAt: daysAgo(2, 13),
    deliveryConfirmedAt: daysAgo(1, 12),
  })

  await prisma.shipment.create({
    data: {
      id: CUSTOMER_FIXTURE.ids.shipments.invoiceReview,
      orderId: CUSTOMER_FIXTURE.ids.orders.invoiceReview,
      sellerId: product.seller.id,
      cargoProvider: 'ptt',
      trackingNumber: 'PWINVOICE001',
      status: 'delivered',
      handedAt: daysAgo(3, 14),
      deliveredAt: daysAgo(2, 13),
    },
  })

  const invoiceFixtureAvailable = false
  const invoiceFixtureError =
    'R2-backed invoice upload fixture is intentionally skipped in local setup.'

  const state: CustomerFixtureState = {
    generatedAt: new Date().toISOString(),
    productSlug: CUSTOMER_FIXTURE.productSlug,
    storeSlug: CUSTOMER_FIXTURE.storeSlug,
    couponCode: CUSTOMER_FIXTURE.couponCode,
    invoiceFixtureAvailable,
    invoiceFixtureError,
    orderIds: CUSTOMER_FIXTURE.ids.orders,
    supportTicketIds: CUSTOMER_FIXTURE.ids.supportTickets,
    returnRequestIds: CUSTOMER_FIXTURE.ids.returnRequests,
    extensionRequestId: CUSTOMER_FIXTURE.ids.extensionRequest,
  }

  await writeState(state)
  await prisma.$disconnect()

  console.log(
    JSON.stringify(
      {
        ok: true,
        statePath: path.relative(ROOT, STATE_PATH),
        invoiceFixtureAvailable,
        invoiceFixtureError,
      },
      null,
      2,
    ),
  )
}

main().catch(async (error) => {
  console.error('ensure-customer-fixtures failed:', error)
  process.exit(1)
})
