import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProduct: vi.fn(),
  mirrorExternalImage: vi.fn(),
}));

vi.mock("../../api/services/catalog.service", () => ({
  createCatalogService: () => ({
    createProduct: mocks.createProduct,
  }),
}));

vi.mock("../../api/services/media.service", () => ({
  createMediaService: () => ({
    mirrorExternalImage: mocks.mirrorExternalImage,
  }),
}));

import { createProductImportService } from "../../api/services/product-import/import.service";

function createMockPrisma() {
  const tx = {
    productAttributeValue: {
      createMany: vi.fn(),
    },
    productVariant: {
      createMany: vi.fn(),
    },
  };

  return {
    productAttributeOption: {
      findMany: vi.fn().mockResolvedValue([
        { id: "color-1", type: "color", label: "Ceviz", slug: "ceviz", sortOrder: 0 },
        { id: "material-1", type: "material", label: "Masif Ahşap", slug: "masif-ahsap", sortOrder: 0 },
      ]),
    },
    category: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "category-1",
          attributeOptions: [
            { option: { id: "color-1", type: "color", label: "Ceviz", slug: "ceviz", sortOrder: 0 } },
            { option: { id: "material-1", type: "material", label: "Masif Ahşap", slug: "masif-ahsap", sortOrder: 0 } },
          ],
        },
      ]),
    },
    barcodeRegistry: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    productImage: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(tx)),
    tx,
  };
}

describe("product import service commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProduct.mockResolvedValue({
      id: "product-1",
      name: "Barkodsuz Urun",
    });
  });

  it("creates a draft product with an auto-generated barcode when selection barcode is missing", async () => {
    const prisma = createMockPrisma();
    const service = createProductImportService({ prisma: prisma as never });

    const created = await service.commit({
      sellerId: "seller-1",
      sellerNumber: 15,
      ownerId: "user-1",
      items: [
        {
          externalId: "hipicon-1",
          name: "Barkodsuz Urun",
          price: 1200,
          sku: "MSSY12",
          imageUrls: [],
          externalUrl: "https://www.hipicon.com/urun/barkodsuz-urun",
        },
      ],
      selections: [{
        externalId: "hipicon-1",
        categoryId: "category-1",
        colorOptionId: "color-1",
        materialOptionId: "material-1",
        modelCode: "MSSY12",
        stockQuantity: 0,
      }],
    });

    expect(created).toEqual([
      {
        id: "product-1",
        name: "Barkodsuz Urun",
        barcode: expect.stringMatching(/^8\d{12}$/),
      },
    ]);
    expect(mocks.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: "category-1",
        barcode: expect.stringMatching(/^8\d{12}$/),
        sku: "MSSY12",
        modelCode: "MSSY12",
      }),
    );
  });

  it("retries barcode allocation when the first generated barcode collides with an existing record", async () => {
    const prisma = createMockPrisma();
    prisma.barcodeRegistry.findUnique
      .mockResolvedValueOnce({ id: "existing-product" })
      .mockResolvedValueOnce(null);
    const service = createProductImportService({ prisma: prisma as never });

    const created = await service.commit({
      sellerId: "seller-1",
      sellerNumber: 120,
      ownerId: "user-1",
      items: [
        {
          externalId: "hipicon-2",
          name: "Kismi Barkodlu Urun",
          price: 800,
          barcode: "12345678901",
          imageUrls: [],
          externalUrl: "https://www.hipicon.com/urun/kismi-barkodlu-urun",
        },
      ],
      selections: [{
        externalId: "hipicon-2",
        categoryId: "category-1",
        colorOptionId: "color-1",
        materialOptionId: "material-1",
        modelCode: "HIPICON-2",
        stockQuantity: 0,
      }],
    });

    expect(created).toEqual([
      {
        id: "product-1",
        name: "Barkodsuz Urun",
        barcode: expect.any(String),
      },
    ]);
    const createPayload = mocks.createProduct.mock.calls[0]?.[0] as
      | { barcode?: string }
      | undefined;
    expect(createPayload?.barcode).toBeDefined();
    expect(createPayload?.barcode).not.toBe("1212345678901");
    // A non-13-digit source barcode is discarded; an "8"-prefixed EAN-13 is generated.
    expect(createPayload?.barcode).toMatch(/^8\d{12}$/);
    expect(prisma.barcodeRegistry.findUnique).toHaveBeenCalledTimes(2);
  });
});
