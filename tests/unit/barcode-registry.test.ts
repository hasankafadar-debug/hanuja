import { describe, expect, it, vi } from 'vitest'
import { prepareVariantBarcodeReplacement } from '../../api/domain/barcode-registry'

describe('barcode replacement preparation', () => {
  it('releases registry rows and moves existing variants away from final swap targets', async () => {
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-a' }, { id: 'variant-b' }]),
        update,
      },
      barcodeRegistry: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    }

    await prepareVariantBarcodeReplacement(prisma as never, 'product-1', ['8691234567890', '8691234567891'])

    expect(prisma.barcodeRegistry.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ productId: 'product-1' }, { variant: { productId: 'product-1' } }] },
    })
    expect(update).toHaveBeenCalledTimes(2)
    for (const call of update.mock.calls) {
      const barcode = call[0].data.barcode as string
      expect(barcode).toMatch(/^\d{13}$/)
      expect(['8691234567890', '8691234567891']).not.toContain(barcode)
    }
  })
})
