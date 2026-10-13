import { describe, it, expect } from 'vitest'
import { categoryVariantPresentation } from '../../api/domain/category-schema'
import catalog from '../../api/domain/category-catalog.json'
import {
  categoryChangePreview,
  normalizedVariantProperties,
  validateVariantDescriptor,
} from '../../api/services/category-schema.service'
import type { ResolvedCategorySchema } from '../../api/domain/category-schema'
function profile(code: string): ResolvedCategorySchema {
  const template = catalog.templates.find((t) => t.code === code)!
  return {
    categoryId: code,
    categoryName: code,
    templateCode: code,
    schemaVersion: 1,
    config: structuredClone(template.config),
    definitions: catalog.fields as ResolvedCategorySchema['definitions'],
  }
}
describe('category change safety', () => {
  it('lists common values removed by the target and binds consent to dimensions and option ids', () => {
    const schema = profile('ELK-AKS')
    schema.config.shared = { color: false, material: false, dimensions: false }
    const product = {
      id: 'p',
      categoryId: 'a',
      updatedAt: new Date('2026-10-13'),
      properties: {},
      attributeValues: [
        { optionId: 'r', option: { type: 'color', label: 'Kırmızı' } },
        { optionId: 'm', option: { type: 'material', label: 'Pamuk' } },
      ],
      dimensionWidth: 15,
    }
    const preview = categoryChangePreview(product, schema)
    expect(preview.removed.map((v) => v.key)).toEqual(['Renk', 'Materyal', 'En'])
    expect(preview.removedAttributeIds).toEqual(['r', 'm'])
    expect(
      categoryChangePreview({ ...product, dimensionWidth: 16 }, schema).confirmationToken,
    ).not.toBe(preview.confirmationToken)
    expect(
      categoryChangePreview(
        {
          ...product,
          attributeValues: [{ optionId: 'other', option: { type: 'color', label: 'Kırmızı' } }],
        },
        schema,
      ).confirmationToken,
    ).not.toBe(preview.confirmationToken)
  })
  it('previews changing the net contents unit and rejects changing it on ordinary edits', () => {
    const schema = profile('KOZ-BAKIM')
    schema.config.variantKey = 'net_icerik'
    schema.config.contentKeys = ['hacim_ml', 'net_agirlik_g']
    const product = {
      id: 'p',
      categoryId: 'a',
      updatedAt: new Date('2026-10-13'),
      properties: {},
      variants: [{ id: 'v', properties: { hacim_ml: 100 } }],
    }
    expect(categoryChangePreview(product, schema, 'g').removed).toEqual([
      { key: 'Varyant v: hacim_ml', value: 100 },
    ])
    expect(() =>
      normalizedVariantProperties(
        schema,
        { net_agirlik_g: 100 },
        {},
        'g',
        { hacim_ml: 100 },
        false,
      ),
    ).toThrow('Birimi değiştirilemez')
  })
  it('rejects shared attributes disguised as custom variant descriptors', () => {
    for (const name of ['Renk', 'renk', ' MATERYAL ', 'Beden', 'Depolama'])
      expect(() => validateVariantDescriptor(name, 'Depolama')).toThrow()
    expect(() => validateVariantDescriptor('Dikiş', 'Beden')).not.toThrow()
  })
})

describe('category variant presentation', () => {
  it('updates the sale-facing name and removes the previous axis', () => {
    const schema = profile('GIY-UST')
    expect(categoryVariantPresentation(schema, { beden: '42' })).toEqual({
      name: 'Beden: 42',
      options: { Beden: '42' },
    })
  })
})
