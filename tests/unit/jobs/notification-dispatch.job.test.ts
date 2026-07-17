import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  findUniqueMock,
  createMock,
  sendEmailMock,
  queueAddMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  sendEmailMock: vi.fn(),
  queueAddMock: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Worker: vi.fn(),
}))

vi.mock('../../../api/lib/redis', () => ({
  redis: {},
}))

vi.mock('../../../api/lib/queue', () => ({
  QUEUE_NAMES: { NOTIFICATION_DISPATCH: 'notification-dispatch' },
  notificationDispatchQueue: { add: queueAddMock },
}))

vi.mock('../../../api/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
    },
    notification: {
      create: createMock,
    },
  },
}))

vi.mock('../../../api/lib/mailer', () => ({
  sendEmail: sendEmailMock,
}))

import {
  enqueueNotification,
  processNotificationDispatch,
  resolveNotificationType,
} from '../../../api/jobs/notification-dispatch.job'

describe('notification-dispatch.job', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    createMock.mockReset()
    sendEmailMock.mockReset()
    queueAddMock.mockReset()
  })

  it('canonicalizes legacy order_confirmed notifications before persisting', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-1',
      data: {
        userId: 'user-1',
        type: 'order_confirmed',
        title: 'Sipariş alındı',
        body: 'Body',
      },
    } as never)

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'order_placed',
      }),
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('skips invalid notification types without creating a record', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await processNotificationDispatch({
      id: 'job-2',
      data: {
        userId: 'user-1',
        type: 'definitely_invalid',
        title: 'Invalid',
        body: 'Body',
      },
    } as never)

    expect(createMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('skips notifications for missing users instead of failing the job', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    findUniqueMock.mockResolvedValue(null)

    await processNotificationDispatch({
      id: 'job-3',
      data: {
        userId: 'missing-user',
        type: 'order_payment_confirmed',
        title: 'Missing user',
        body: 'Body',
      },
    } as never)

    expect(createMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('queues notifications with retries intact', async () => {
    await enqueueNotification({
      userId: 'user-1',
      type: 'order_payment_confirmed',
      title: 'Queued',
      body: 'Body',
    })

    expect(queueAddMock).toHaveBeenCalledWith(
      'notify',
      expect.objectContaining({ type: 'order_payment_confirmed' }),
      expect.objectContaining({ attempts: 3 }),
    )
  })

  it('resolves canonical and legacy notification types', () => {
    expect(resolveNotificationType('order_payment_confirmed')).toBe('order_payment_confirmed')
    expect(resolveNotificationType('order_confirmed')).toBe('order_placed')
  })

  it('sends invoice_uploaded emails with the fatura category and support replyTo', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-invoice',
      data: {
        userId: 'user-1',
        type: 'invoice_uploaded',
        title: 'Fatura yüklendi',
        body: 'Body',
        emailTo: 'customer@example.com',
        data: { customerName: 'Ayşe', orderNumber: 'ABC12345' },
      },
    } as never)

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        fromCategory: 'fatura',
        replyTo: 'admin@hanuja.com.tr',
      }),
    )
  })

  it('passes the orderUrl through to the invoice_uploaded email template', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-invoice-url',
      data: {
        userId: 'user-1',
        type: 'invoice_uploaded',
        title: 'Fatura yüklendi',
        body: 'Body',
        emailTo: 'customer@example.com',
        data: {
          customerName: 'Ayşe',
          orderNumber: 'ABC12345',
          orderUrl: 'https://www.hanuja.com.tr/siparis/order-1',
        },
      },
    } as never)

    const call = sendEmailMock.mock.calls[0]?.[0]
    expect(call.html).toContain('href="https://www.hanuja.com.tr/siparis/order-1"')
    expect(call.text).toContain('https://www.hanuja.com.tr/siparis/order-1')
  })

  it('omits the invoice CTA when no orderUrl is present in the job payload', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-invoice-nourl',
      data: {
        userId: 'user-1',
        type: 'invoice_uploaded',
        title: 'Fatura yüklendi',
        body: 'Body',
        emailTo: 'customer@example.com',
        data: { customerName: 'Ayşe', orderNumber: 'ABC12345' },
      },
    } as never)

    const call = sendEmailMock.mock.calls[0]?.[0]
    expect(call.html).not.toContain('Siparişimi Görüntüle')
    expect(call.html).not.toContain('/siparis/')
  })

  it('does not override an explicit replyTo for fatura emails', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-invoice-replyto',
      data: {
        userId: 'user-1',
        type: 'invoice_uploaded',
        title: 'Fatura yüklendi',
        body: 'Body',
        emailTo: 'customer@example.com',
        replyTo: 'seller@example.com',
        data: { customerName: 'Ayşe', orderNumber: 'ABC12345' },
      },
    } as never)

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromCategory: 'fatura',
        replyTo: 'seller@example.com',
      }),
    )
  })

  it('sends store discount emails with the kampanya category', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-kampanya',
      data: {
        userId: 'user-1',
        type: 'store_discount_followed_seller',
        title: 'İndirim başladı',
        body: 'Body',
        emailTo: 'customer@example.com',
        data: {
          customerName: 'Ayşe',
          sellerName: 'Atelier Noa',
          storeUrl: 'https://www.hanuja.com.tr/magaza/atelier-noa',
          unsubscribeUrl: 'https://www.hanuja.com.tr/takip/cikis?t=abc',
        },
      },
    } as never)

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ fromCategory: 'kampanya' }),
    )
  })

  it('sends product_discount_favorited emails with kampanya category and List-Unsubscribe headers', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-discount-fav',
      data: {
        userId: 'user-1',
        type: 'product_discount_favorited',
        title: 'Favorinizdeki üründe indirim başladı',
        body: 'Body',
        emailTo: 'customer@example.com',
        data: {
          customerName: 'Ayşe',
          productName: 'Meşe Sehpa',
          productUrl: 'https://www.hanuja.com.tr/urun/mese-sehpa',
          sellerName: 'Atelier Noa',
          unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc',
        },
      },
    } as never)

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromCategory: 'kampanya',
        headers: {
          'List-Unsubscribe': '<https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    )
    const call = sendEmailMock.mock.calls[0]?.[0]
    expect(call.subject).toBe('Favorinizdeki Ürün Şimdi İndirimde')
  })

  it('sends product_discount_in_cart emails with kampanya category', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-discount-cart',
      data: {
        userId: 'user-1',
        type: 'product_discount_in_cart',
        title: 'Sepetinizdeki üründe indirim başladı',
        body: 'Body',
        emailTo: 'customer@example.com',
        data: {
          customerName: 'Ayşe',
          productName: 'Rattan Konsol',
          productUrl: 'https://www.hanuja.com.tr/urun/rattan-konsol',
          sellerName: 'Woodform',
          unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=xyz',
        },
      },
    } as never)

    const call = sendEmailMock.mock.calls[0]?.[0]
    expect(call.fromCategory).toBe('kampanya')
    expect(call.subject).toBe('Sepetinizdeki Ürün Şimdi İndirimde')
  })

  it('creates the in-app record but sends NO email for product_discount_favorited without emailTo', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-discount-fav-noemail',
      data: {
        userId: 'user-1',
        type: 'product_discount_favorited',
        title: 'Favorinizdeki üründe indirim başladı',
        body: 'Body',
        // no emailTo — in-app only
        data: {
          customerName: 'Ayşe',
          productName: 'Meşe Sehpa',
          productUrl: 'https://www.hanuja.com.tr/urun/mese-sehpa',
          sellerName: 'Atelier Noa',
          unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc',
        },
      },
    } as never)

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', type: 'product_discount_favorited' }),
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('creates the in-app record but sends NO email for product_discount_in_cart without emailTo', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-discount-cart-noemail',
      data: {
        userId: 'user-1',
        type: 'product_discount_in_cart',
        title: 'Sepetinizdeki üründe indirim başladı',
        body: 'Body',
        // no emailTo — in-app only
        data: {
          customerName: 'Ayşe',
          productName: 'Rattan Konsol',
          productUrl: 'https://www.hanuja.com.tr/urun/rattan-konsol',
          sellerName: 'Woodform',
          unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=xyz',
        },
      },
    } as never)

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', type: 'product_discount_in_cart' }),
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('adds List-Unsubscribe headers to store_discount_followed_seller emails when unsubscribeUrl is present', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-kampanya-headers',
      data: {
        userId: 'user-1',
        type: 'store_discount_followed_seller',
        title: 'İndirim başladı',
        body: 'Body',
        emailTo: 'customer@example.com',
        data: {
          customerName: 'Ayşe',
          sellerName: 'Atelier Noa',
          storeUrl: 'https://www.hanuja.com.tr/magaza/atelier-noa',
          unsubscribeUrl: 'https://www.hanuja.com.tr/api/store-follows/unsubscribe?token=abc',
        },
      },
    } as never)

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'List-Unsubscribe': '<https://www.hanuja.com.tr/api/store-follows/unsubscribe?token=abc>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    )
  })

  it('omits List-Unsubscribe headers for kampanya emails with no unsubscribeUrl', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-kampanya-no-headers',
      data: {
        userId: 'user-1',
        type: 'store_discount_followed_seller',
        title: 'İndirim başladı',
        body: 'Body',
        emailTo: 'customer@example.com',
        data: {
          customerName: 'Ayşe',
          sellerName: 'Atelier Noa',
          storeUrl: 'https://www.hanuja.com.tr/magaza/atelier-noa',
          unsubscribeUrl: '',
        },
      },
    } as never)

    const call = sendEmailMock.mock.calls[0]?.[0]
    expect(call).not.toHaveProperty('headers')
  })

  it('defaults to the noreply category and no injected replyTo for other emails', async () => {
    findUniqueMock.mockResolvedValue({ id: 'user-1' })

    await processNotificationDispatch({
      id: 'job-order',
      data: {
        userId: 'user-1',
        type: 'order_delivery_confirmed',
        title: 'Teslim onaylandı',
        body: 'Body',
        emailTo: 'customer@example.com',
        data: { customerName: 'Ayşe', orderNumber: 'ABC12345' },
      },
    } as never)

    const call = sendEmailMock.mock.calls[0]?.[0]
    expect(call).toMatchObject({ fromCategory: 'noreply' })
    expect(call).not.toHaveProperty('replyTo')
  })
})
