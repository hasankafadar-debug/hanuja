import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@prisma/client/runtime/client";

const {
  getSessionMock,
  createPrismaForRouteMock,
  createCatalogServiceMock,
  updateProductForSellerMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  createPrismaForRouteMock: vi.fn(),
  createCatalogServiceMock: vi.fn(),
  updateProductForSellerMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@hanuja/api/lib/prisma", () => ({
  createPrismaForRoute: createPrismaForRouteMock,
}));

vi.mock("@hanuja/api/services/catalog.service", () => ({
  createCatalogService: createCatalogServiceMock,
}));

function createPrismaMock() {
  const prisma = {
    seller: {
      findUnique: vi.fn().mockResolvedValue({ id: "seller-1" }),
    },
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: "product-1", stockQuantity: 10 }),
      update: vi.fn().mockResolvedValue({ id: "product-1", stockQuantity: 13 }),
    },
    productVariant: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: "cmoms85180003ula8nt4h6y3h",
          stockQuantity: 5,
        }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "cmoms85180003ula8nt4h6y3h",
        price: new Decimal(120),
        stockQuantity: 8,
      }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { stockQuantity: 13 } }),
      count: vi.fn().mockResolvedValue(1),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({
        id: "cmoms85180003ula8nt4h6y3h",
        price: new Decimal(120),
        stockQuantity: 8,
      }),
      create: vi.fn(),
    },
    productAttributeValue: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma),
    ),
  };

  return prisma;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({
    user: { id: "seller-user-1", role: "seller" },
  });
  updateProductForSellerMock.mockResolvedValue({
    id: "product-1",
    name: "Test Urun",
    status: "published",
  });
  createCatalogServiceMock.mockReturnValue({
    updateProductForSeller: updateProductForSellerMock,
  });
});

describe("seller product variant quick updates", () => {
  it("updates one variant stock and increments only the aggregate product stock", async () => {
    const prisma = createPrismaMock();
    createPrismaForRouteMock.mockReturnValue(prisma);

    const route =
      await import("../../../apps/seller-panel/src/app/api/seller/products/[id]/variants/[variantId]/route");
    const response = await route.PATCH(
      new Request(
        "http://localhost/api/seller/products/product-1/variants/variant-1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stockQuantity: 8 }),
        },
      ) as never,
      {
        params: Promise.resolve({
          id: "product-1",
          variantId: "cmoms85180003ula8nt4h6y3h",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(prisma.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cmoms85180003ula8nt4h6y3h" },
        data: { stockQuantity: 8 },
      }),
    );
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stockQuantity: 13 } }),
    );
    expect(await response.json()).toEqual({
      variant: {
        id: "cmoms85180003ula8nt4h6y3h",
        price: 120,
        stockQuantity: 8,
      },
      product: { id: "product-1", stockQuantity: 13 },
    });
  });

  it("updates a variant price without changing the independent product price or stock", async () => {
    const prisma = createPrismaMock();
    createPrismaForRouteMock.mockReturnValue(prisma);

    const route =
      await import("../../../apps/seller-panel/src/app/api/seller/products/[id]/variants/[variantId]/route");
    const response = await route.PATCH(
      new Request(
        "http://localhost/api/seller/products/product-1/variants/variant-1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ price: 120 }),
        },
      ) as never,
      {
        params: Promise.resolve({
          id: "product-1",
          variantId: "cmoms85180003ula8nt4h6y3h",
        }),
      },
    );

    expect(response.status).toBe(200);
    const priceUpdate = prisma.productVariant.update.mock.calls[0]?.[0];
    expect(priceUpdate.where).toEqual({ id: "cmoms85180003ula8nt4h6y3h" });
    expect(priceUpdate.data.price.toString()).toBe("120");
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stockQuantity: 13 } }),
    );
  });

  it.each([
    [{}, "Fiyat veya stok alanlarindan en az biri gonderilmelidir."],
    [{ stockQuantity: -1 }, "Stok negatif olamaz"],
    [{ price: 0 }, "Fiyat 0dan buyuk olmali"],
  ])("rejects invalid variant patches", async (body, expectedError) => {
    const prisma = createPrismaMock();
    createPrismaForRouteMock.mockReturnValue(prisma);

    const route =
      await import("../../../apps/seller-panel/src/app/api/seller/products/[id]/variants/[variantId]/route");
    const response = await route.PATCH(
      new Request(
        "http://localhost/api/seller/products/product-1/variants/variant-1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ) as never,
      { params: Promise.resolve({ id: "product-1", variantId: "variant-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expectedError });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not allow a seller to update another product variant", async () => {
    const prisma = createPrismaMock();
    prisma.productVariant.findFirst.mockResolvedValue(null);
    createPrismaForRouteMock.mockReturnValue(prisma);

    const route =
      await import("../../../apps/seller-panel/src/app/api/seller/products/[id]/variants/[variantId]/route");
    const response = await route.PATCH(
      new Request(
        "http://localhost/api/seller/products/other/variants/variant-1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stockQuantity: 4 }),
        },
      ) as never,
      {
        params: Promise.resolve({
          id: "other-product",
          variantId: "variant-1",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(prisma.productVariant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "variant-1",
          productId: "other-product",
          product: { sellerId: "seller-1" },
        },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});

describe("seller full product stock updates", () => {
  it("uses the submitted stock when a product has an empty variant list", async () => {
    const prisma = createPrismaMock();
    createPrismaForRouteMock.mockReturnValue(prisma);

    const route =
      await import("../../../apps/seller-panel/src/app/api/seller/products/[id]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/seller/products/product-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockQuantity: 9,
          barcode: "8691234567890",
          variants: [],
        }),
      }) as never,
      { params: Promise.resolve({ id: "product-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateProductForSellerMock).toHaveBeenCalledWith(
      expect.objectContaining({ stockQuantity: 9, barcode: "8691234567890" }),
    );
  });

  it("accepts CUID variant ids and derives the aggregate stock from variants", async () => {
    const prisma = createPrismaMock();
    prisma.productVariant.findFirst.mockResolvedValue(null);
    createPrismaForRouteMock.mockReturnValue(prisma);

    const route =
      await import("../../../apps/seller-panel/src/app/api/seller/products/[id]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/seller/products/product-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variants: [
            {
              id: "cmoms85180003ula8nt4h6y3h",
              barcode: "8691234567891",
              price: 120,
              stockQuantity: 7,
            },
          ],
        }),
      }) as never,
      { params: Promise.resolve({ id: "product-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateProductForSellerMock).toHaveBeenCalledWith(
      expect.objectContaining({ stockQuantity: 7, barcode: null }),
    );
    expect(prisma.productVariant.count).toHaveBeenCalledWith({
      where: {
        productId: "product-1",
        id: { in: ["cmoms85180003ula8nt4h6y3h"] },
      },
    });
  });

  it("rejects variant ids that do not belong to the edited product", async () => {
    const prisma = createPrismaMock();
    prisma.productVariant.findFirst.mockResolvedValue(null);
    prisma.productVariant.count.mockResolvedValue(0);
    createPrismaForRouteMock.mockReturnValue(prisma);

    const route =
      await import("../../../apps/seller-panel/src/app/api/seller/products/[id]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/seller/products/product-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variants: [
            {
              id: "cmoms85180003ula8nt4h6y3h",
              barcode: "8691234567891",
              price: 120,
              stockQuantity: 7,
            },
          ],
        }),
      }) as never,
      { params: Promise.resolve({ id: "product-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Varyasyonlardan biri bu urune ait degil.",
    });
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
  });
});
