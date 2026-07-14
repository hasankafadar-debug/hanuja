import { describe, expect, it, vi } from "vitest"
import { createProductRepository } from "../../../api/repositories/product.repository"

describe("product.repository seller listing", () => {
  it("loads ordered variants for variant-level stock and price editing", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const repository = createProductRepository({ product: { findMany } } as never)

    await repository.listBySeller({ sellerId: "seller-1", take: 50 })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sellerId: "seller-1" },
        include: expect.objectContaining({
          variants: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        }),
        take: 50,
      }),
    )
  })
})
