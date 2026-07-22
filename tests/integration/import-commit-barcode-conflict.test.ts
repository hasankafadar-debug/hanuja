/**
 * Integration tests — import commit barcode conflict handling
 *
 * When seller provides an override barcode that is already in use,
 * the service must throw with a descriptive message instead of silently
 * falling back to an auto-generated barcode.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../api/lib/prisma', () => ({
  prisma: {},
  createPrismaForRoute: () => ({}),
  default: {},
}))

vi.mock('../../api/lib/queue', () => ({
  getQueue: vi.fn(),
  addJob: vi.fn(),
}))

vi.mock('../../api/lib/meilisearch', () => ({ getMeilisearchClient: vi.fn() }))
vi.mock('../../api/lib/r2', () => ({ getR2Client: vi.fn() }))

import { createProductImportService } from '../../api/services/product-import/import.service'

describe('import commit — barcode override conflict', () => {
  it('throws when override barcode is already in use', async () => {
    const conflictBarcode = '1234567890123'

    const colorOption = { id: 'color-1', type: 'color', label: 'Kırmızı', slug: 'kirmizi', sortOrder: 0 }
    const materialOption = { id: 'material-1', type: 'material', label: 'Ahşap', slug: 'ahsap', sortOrder: 0 }

    const mockPrisma = {
      barcodeRegistry: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: { barcode: string } }) =>
          where.barcode === conflictBarcode ? { barcode: conflictBarcode } : null,
        ),
      },
      productAttributeOption: {
        findMany: vi.fn().mockResolvedValue([colorOption, materialOption]),
      },
      category: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cat-1',
            attributeOptions: [{ option: colorOption }, { option: materialOption }],
          },
        ]),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Parameters<typeof createProductImportService>[0]['prisma']

    const service = createProductImportService({ prisma: mockPrisma })

    const fakeItem = {
      externalId: 'ext-1',
      name: 'Test Ürün',
      price: 100,
      imageUrls: [],
      externalUrl: 'https://hipicon.com/test',
      barcode: undefined,
      variants: [],
    }

    await expect(
      service.commit({
        sellerId: 'seller-1',
        sellerNumber: 1,
        ownerId: 'user-1',
        items: [fakeItem],
        selections: [
          {
            externalId: 'ext-1',
            categoryId: 'cat-1',
            colorOptionId: 'color-1',
            materialOptionId: 'material-1',
            barcode: conflictBarcode,
            modelCode: 'TEST-MODEL-1',
            fulfillmentDays: 7,
            stockQuantity: 5,
          },
        ],
      }),
    ).rejects.toThrow(/zaten kullanımda/i)
  })
})
