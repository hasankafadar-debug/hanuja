import { ValidationError } from '../lib/errors'

export interface CategoryWithChildrenActiveFlag {
  children: { isActive: boolean }[]
}

/**
 * Business rule: a product may only be attached to a LEAF category — a
 * category with no active children. Ara (non-leaf) kategoriler yalnızca
 * navigasyon/gruplama amaçlıdır; ürün ekleme yaprak seviyede zorunludur.
 *
 * A category with only inactive children still counts as a leaf: inactive
 * children are effectively retired branches and must not block sellers from
 * using their parent as a valid product destination.
 */
export function isLeafCategory(category: CategoryWithChildrenActiveFlag): boolean {
  return !category.children.some((child) => child.isActive)
}

/**
 * Guards product-category assignment. Throws ValidationError when the given
 * category has at least one active child, i.e. it is not a leaf category.
 *
 * Must be called from the domain/service layer (catalog.service.ts) for
 * every path that assigns/changes a product's category — never only at the
 * route layer — per .claude/rules/02-coding-standards.md business logic
 * placement rules.
 */
export function assertLeafCategory(category: CategoryWithChildrenActiveFlag): void {
  if (!isLeafCategory(category)) {
    throw new ValidationError('Ürün yalnızca en alt seviye kategoriye eklenebilir.')
  }
}
