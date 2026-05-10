import { describe, expect, it } from 'vitest'
import { buildCategoryTaxGroups, type CategoryTaxGroupInput } from '../../../api/domain/category-tax-groups'

function buildCategory(input: Partial<CategoryTaxGroupInput> & Pick<CategoryTaxGroupInput, 'id' | 'name'>): CategoryTaxGroupInput {
  return {
    slug: input.name.toLocaleLowerCase('tr-TR'),
    sortOrder: 0,
    isActive: true,
    taxRate: null,
    parent: null,
    children: [],
    ...input,
  }
}

describe('buildCategoryTaxGroups', () => {
  it('includes only first-level main categories under roots and excludes leaves', () => {
    const groups = buildCategoryTaxGroups([
      buildCategory({
        id: 'root-ev',
        name: 'Ev',
        children: [{ id: 'main-mobilya-ev' }],
      }),
      buildCategory({
        id: 'main-mobilya-ev',
        name: 'Mobilya',
        parent: { id: 'root-ev', name: 'Ev', parentId: null },
        children: [{ id: 'leaf-sehpa' }],
        taxRate: '0.18',
      }),
      buildCategory({
        id: 'leaf-sehpa',
        name: 'Sehpa',
        parent: { id: 'main-mobilya-ev', name: 'Mobilya', parentId: 'root-ev' },
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.name).toBe('Mobilya')
    expect(groups[0]?.memberPaths).toEqual(['Ev / Mobilya'])
  })

  it('groups same-named main categories from different roots into one row', () => {
    const groups = buildCategoryTaxGroups([
      buildCategory({
        id: 'main-mobilya-ev',
        name: 'Mobilya',
        parent: { id: 'root-ev', name: 'Ev', parentId: null },
        children: [{ id: 'leaf-a' }],
        taxRate: '0.18',
      }),
      buildCategory({
        id: 'main-mobilya-ofis',
        name: 'Mobilya',
        parent: { id: 'root-ofis', name: 'Ofis', parentId: null },
        children: [{ id: 'leaf-b' }],
        taxRate: '0.18',
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      name: 'Mobilya',
      memberCount: 2,
      taxRate: '0.18',
      hasMixedRates: false,
    })
    expect(groups[0]?.memberPaths).toEqual(['Ev / Mobilya', 'Ofis / Mobilya'])
  })

  it('marks the row as Karma when grouped categories have different rates', () => {
    const groups = buildCategoryTaxGroups([
      buildCategory({
        id: 'main-aydinlatma-ev',
        name: 'Aydınlatma',
        parent: { id: 'root-ev', name: 'Ev', parentId: null },
        children: [{ id: 'leaf-a' }],
        taxRate: '0.10',
      }),
      buildCategory({
        id: 'main-aydinlatma-ofis',
        name: 'Aydınlatma',
        parent: { id: 'root-ofis', name: 'Ofis', parentId: null },
        children: [{ id: 'leaf-b' }],
        taxRate: '0.20',
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      name: 'Aydınlatma',
      taxRate: null,
      hasMixedRates: true,
    })
  })
})
