import { Decimal } from '@prisma/client/runtime/client'

export function calculateIncludedTax(grossAmount: Decimal, taxRate: Decimal): Decimal {
  if (grossAmount.lte(0) || taxRate.lte(0)) return new Decimal(0)
  return grossAmount.sub(grossAmount.div(new Decimal(1).add(taxRate))).toDecimalPlaces(2)
}

export function resolveCategoryTaxRate(
  categoryId: string | null | undefined,
  categories: Map<string, { parentId: string | null; taxRate: Decimal | null }>,
  defaultTaxRate: Decimal,
): Decimal {
  let currentId = categoryId ?? null
  const seen = new Set<string>()

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const category = categories.get(currentId)
    if (!category) break
    if (category.taxRate) return category.taxRate
    currentId = category.parentId
  }

  return defaultTaxRate
}
