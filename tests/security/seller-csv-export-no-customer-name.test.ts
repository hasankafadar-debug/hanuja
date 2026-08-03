/**
 * Seller JSON and CSV responses must consume the same seller-safe DTO so a
 * bulk export cannot reconstruct customer account identity.
 */
import { describe, expect, it } from 'vitest'
import { buildSellerOrderCsv, toSellerSafeOrderDtos } from '../../api/lib/seller-order-projection'

function projectOrder(customer: { name?: string | null; email?: string } | null) {
  return toSellerSafeOrderDtos([
    {
      id: 'order_xyz12345',
      createdAt: new Date('2026-04-27T00:00:00Z'),
      status: 'preparing',
      customer,
      address: {
        fullName: 'Delivery Recipient',
        phone: '05321234567',
        addressLine1: 'Fulfilment Street 42',
      },
      lines: [{ quantity: 1, unitPrice: 250, product: { name: 'Sehpa' } }],
    },
  ])[0]!
}

describe('seller orders JSON and CSV - no customer account identity leakage', () => {
  it('masks customer name and removes customer email from both outputs', () => {
    const order = projectOrder({ name: 'Ahmet Yilmaz', email: 'buyer.private@example.test' })
    const csv = buildSellerOrderCsv([order])

    expect(order.customer?.name).toBe('Ahmet Y.')
    expect(JSON.stringify(order)).not.toContain('buyer.private@example.test')
    expect(csv).toContain('"Ahmet Y."')
    expect(csv).not.toContain('Yilmaz')
    expect(csv).not.toContain('buyer.private@example.test')
  })

  it('retains delivery address and phone needed for fulfilment in the JSON DTO', () => {
    const order = projectOrder({ name: 'Mehmet Demir', email: 'buyer.private@example.test' })

    expect(order.address.fullName).toBe('Delivery Recipient')
    expect(order.address.phone).toBe('05321234567')
    expect(order.address.addressLine1).toBe('Fulfilment Street 42')
    expect(JSON.stringify(order)).not.toContain('buyer.private@example.test')
  })

  it('uses a placeholder for a missing customer', () => {
    const csv = buildSellerOrderCsv([projectOrder(null)])
    expect(csv).toContain('"-"')
  })
})
