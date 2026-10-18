import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn() }))
vi.mock('../../../api/lib/prisma', () => ({
  createPrismaForRoute: () => ({}),
}))
vi.mock('../../../api/services/notification.service', () => ({
  createNotificationService: () => ({
    listForUser: mocks.list,
    countUnread: mocks.count,
  }),
}))
import { listNotifications } from '../../../api/routes/notifications'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([
    {
      id: 'n1',
      type: 'admin_support_new_ticket',
      data: { threadId: 't1' },
      isRead: false,
      readAt: null,
    },
  ])
  mocks.count.mockResolvedValue(1)
})

describe('panel notification list response', () => {
  it('adds the admin destination without changing read state or ownership', async () => {
    const result = await listNotifications(
      new NextRequest('https://admin.test/api/notifications?limit=15'),
      'admin-1',
      'admin',
    )
    expect(await result.json()).toMatchObject({
      data: {
        unreadCount: 1,
        items: [{ href: '/musteri-sorulari/t1', isRead: false, readAt: null }],
      },
    })
    expect(mocks.list).toHaveBeenCalledWith('admin-1', {
      unreadOnly: false,
      limit: 15,
      skip: 0,
    })
    expect(mocks.count).toHaveBeenCalledWith('admin-1')
  })
  it('uses the panel passed by the authenticated route, ignoring query parameters', async () => {
    const result = await listNotifications(
      new NextRequest('https://seller.test/api/notifications?panel=admin'),
      'seller-1',
      'seller',
    )
    expect(await result.json()).toMatchObject({
      data: { items: [{ href: null }] },
    })
  })
  it('preserves the existing storefront response', async () => {
    const result = await listNotifications(
      new NextRequest('https://web.test/api/notifications'),
      'customer-1',
    )
    const payload = await result.json()
    expect(payload.data.items[0]).not.toHaveProperty('href')
  })
})
