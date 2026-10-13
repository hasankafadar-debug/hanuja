import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import catalog from '../../api/domain/category-catalog.json'
import {
  allowedSizeValues,
  canonicalNumber,
  validateProperties,
  type ResolvedCategorySchema,
  type ProductProperties,
} from '../../api/domain/category-schema'
import {
  normalizedProductProperties,
  normalizedVariantProperties,
  categoryChangePreview,
} from '../../api/services/category-schema.service'
import {
  buildPropertyFacets,
  filterValuesForProduct,
  matchesPropertyFilters,
  meiliPropertyFilter,
  parsePropertyFilters,
} from '../../api/domain/property-filters'
import { incompatibleTemplateChange } from '../../api/services/catalog-admin.service'
function schema(code: string, name = 'Sweatshirt'): ResolvedCategorySchema {
  const template = catalog.templates.find((t) => t.code === code)!
  return {
    categoryId: 'cat-1',
    categoryName: name,
    templateCode: code,
    schemaVersion: template.compatibilityVersion,
    config: template.config,
    definitions: catalog.fields.filter((d) => template.config.fields.some((f) => f.key === d.key)),
  }
}
describe('approved initial category contract', () => {
  it('matches every new leaf and template assignment in Appendix B', () => {
    const document = readFileSync(resolve('../kategori-plani-ek.md'), 'utf8').split('## Ek B')[1]!
    const expected = new Map<string, string>()
    for (const match of document.matchAll(/^\| `([^`]+)` \| \d+ \| ([^\n]+) \|$/gm))
      for (const path of match[2]!.split(' · ')) expected.set(path.trim(), match[1]!)
    const nodes = new Map(catalog.nodes.map((n) => [n.slug, n]))
    const leaves = catalog.nodes.filter(
      (n) => !catalog.nodes.some((child) => child.parentSlug === n.slug),
    )
    expect(leaves).toHaveLength(280)
    const required: Record<string, unknown> = {}
    for (const leaf of leaves) {
      const parent = nodes.get(leaf.parentSlug!)!
      const path = `${parent.name} > ${leaf.name}`
      const code = leaf.templateCode ?? parent.templateCode!
      expect(expected.get(path), path).toBe(code)
      const profile = schema(code, leaf.name)
      required[path] = {
        template: profile.templateCode,
        fields: profile.config.fields.filter((f) => f.required).map((f) => f.key),
        groups: profile.config.requiredGroups,
      }
    }
    expect(required).toMatchSnapshot()
  })
  it('does not require contents or warranty where they do not apply', () => {
    for (const code of ['KOZ-ARAC', 'KOZ-SET', 'ELK-AKS'])
      expect(
        validateProperties({
          schema: schema(code),
          values: code === 'KOZ-SET' ? { set_icerigi: 'İki ürün' } : {},
          creating: true,
        }).errors,
      ).toEqual([])
  })
  it('keeps diaper count common while diaper size varies', () => {
    const profile = schema('BEB-BEZ', 'Bebek Bezi')
    expect(
      normalizedProductProperties(profile, { paket_adedi: 40 }, {}, true, 'bez_numarasi', true),
    ).toMatchObject({ paket_adedi: 40 })
    expect(
      normalizedVariantProperties(profile, { bez_numarasi: '4' }, { paket_adedi: 40 }),
    ).toEqual({ bez_numarasi: '4' })
    expect(() => normalizedProductProperties(profile, {}, {}, true, 'bez_numarasi', true)).toThrow(
      'Paket Adedi',
    )
  })
  it('normalizes units without buckets and uses decimal TB', () => {
    for (const [key, input, expected] of [
      ['depolama_gb', '1 TB', 1000],
      ['hacim_ml', '0,5 L', 500],
      ['net_agirlik_g', '1 kg', 1000],
      ['minimum_yas_ay', '3 yıl', 36],
    ] as const)
      expect(canonicalNumber(catalog.fields.find((d) => d.key === key)!, input)).toBe(expected)
  })
  it('limits shoe and adult garment size lists', () => {
    expect(allowedSizeValues(schema('AYK', 'Spor Ayakkabı'), 'yetiskin')).not.toContain('75B')
    expect(allowedSizeValues(schema('GIY-UST'), 'yetiskin')).not.toContain('6-9 Ay')
    expect(() =>
      normalizedVariantProperties(
        schema('GIY-UST'),
        { beden: '6-9 Ay' },
        { cinsiyet: 'unisex', yas_grubu: 'yetiskin' },
      ),
    ).toThrow('Beden')
  })
  it('accepts legacy empty required values on ordinary edits but prevents clearing', () => {
    const profile = schema('GIY-UST')
    expect(
      validateProperties({ schema: profile, values: {}, previous: {}, creating: false }).errors,
    ).toEqual([])
    expect(
      validateProperties({
        schema: profile,
        values: { cinsiyet: '' },
        previous: { cinsiyet: 'unisex' },
        creating: false,
      }).errors,
    ).toContain('Cinsiyet zorunludur.')
  })
  it('retains removed properties and grandfathered options', () => {
    const profile = schema('GIY-UST'),
      previous: ProductProperties = {
        cinsiyet: 'unisex',
        yas_grubu: 'yetiskin',
        removed_field: 'sakla',
      }
    profile.config = structuredClone(profile.config)
    profile.definitions = structuredClone(profile.definitions)
    profile.config.fields.find((f) => f.key === 'cinsiyet')!.optionIds = ['kadin', 'erkek']
    profile.definitions
      .find((d) => d.key === 'cinsiyet')!
      .config.options!.find((o) => o.id === 'unisex')!.isActive = false
    expect(normalizedProductProperties(profile, {}, previous, false)).toMatchObject(previous)
    expect(() =>
      normalizedProductProperties(profile, { cinsiyet: 'unisex', yas_grubu: 'yetiskin' }),
    ).toThrow('pasif')
  })
  it('binds category consent to saved values, without changing on temporary barcodes', () => {
    const product = {
      id: 'p',
      categoryId: 'a',
      updatedAt: new Date('2026-10-13'),
      properties: { sil: 'x' },
      variants: [{ id: 'v', properties: { eski: 'a' }, barcode: '1' }],
    }
    const first = categoryChangePreview(product, schema('GIY-UST'))
    expect(
      categoryChangePreview(
        { ...product, variants: [{ ...product.variants[0]!, barcode: 'temporary' }] },
        schema('GIY-UST'),
      ).confirmationToken,
    ).toBe(first.confirmationToken)
    expect(
      categoryChangePreview(
        { ...product, variants: [{ id: 'v', properties: { eski: 'b' } }] },
        schema('GIY-UST'),
      ).confirmationToken,
    ).not.toBe(first.confirmationToken)
    expect(first.removed).toHaveLength(2)
  })
  it('only increments the changed template for incompatible changes', () => {
    const config = schema('GIY-UST').config,
      next = structuredClone(config)
    next.fields.push({ key: 'optional_new', required: false })
    expect(incompatibleTemplateChange(config, next)).toBe(false)
    next.fields[next.fields.length - 1]!.required = true
    expect(incompatibleTemplateChange(config, next)).toBe(true)
  })
})
describe('stock-aware property filters', () => {
  const profile = schema('KOZ-PARFUM', 'Parfüm')
  const product = {
    id: 'p',
    categoryId: 'cat-1',
    stockQuantity: 5,
    properties: {},
    variants: [
      { stockQuantity: 2, properties: { hacim_ml: 50 } },
      { stockQuantity: 3, properties: { hacim_ml: 200 } },
      { stockQuantity: 0, properties: { hacim_ml: 100 } },
    ],
  }
  it('does not match 90–110 across [50,200] or through a sold-out variant', () => {
    expect(
      matchesPropertyFilters(filterValuesForProduct(product, profile), {
        hacim_ml: { min: 90, max: 110 },
      }),
    ).toBe(false)
    expect(
      meiliPropertyFilter({ hacim_ml: { min: 90, max: 110 } }, new Map([['cat-1', profile]]))[0],
    ).toContain('hacim_ml_stokta 90 TO 110')
  })
  it('counts unique products rather than their matching variants', () => {
    const facet = buildPropertyFacets(
      [
        {
          ...product,
          variants: [...product.variants, { stockQuantity: 1, properties: { hacim_ml: 50 } }],
        },
      ],
      new Map([['cat-1', profile]]),
    ).find((f) => f.key === 'hacim_ml')!
    expect(facet.values.find((v) => v.value === '50')?.count).toBe(1)
    expect(facet.values.some((v) => v.value === '100')).toBe(false)
  })
  it('uses actual numeric values up to 12 choices and ranges above 12', () => {
    const products = Array.from({ length: 13 }, (_, i) => ({
      id: `p${i}`,
      categoryId: 'cat-1',
      stockQuantity: 1,
      properties: { hacim_ml: i + 1 },
      variants: [],
    }))
    expect(buildPropertyFacets(products.slice(0, 12), new Map([['cat-1', profile]]))[0]?.kind).toBe(
      'choices',
    )
    expect(buildPropertyFacets(products, new Map([['cat-1', profile]]))[0]?.kind).toBe('range')
  })
  it('includes Unisex in women and men without duplicate product counts', () => {
    const garment = schema('GIY-UST')
    const p = {
      id: 'u',
      categoryId: 'cat-1',
      stockQuantity: 1,
      properties: { cinsiyet: 'unisex', yas_grubu: 'yetiskin', beden: 'M' },
      variants: [],
    }
    expect(
      matchesPropertyFilters(filterValuesForProduct(p, garment), {
        cinsiyet: { values: ['kadin'] },
      }),
    ).toBe(true)
    expect(
      buildPropertyFacets([p], new Map([['cat-1', garment]]))
        .find((f) => f.key === 'cinsiyet')
        ?.values.find((v) => v.value === 'kadin')?.count,
    ).toBe(1)
  })
  it('keeps comma-containing sizes intact and rejects malformed filter keys', () => {
    expect(
      parsePropertyFilters(
        new URLSearchParams({ 'f.beden': '["42,5"]', 'r.hacim_ml.min': '90', 'f.bad()': '["x"]' }),
      ),
    ).toEqual({ beden: { values: ['42,5'] }, hacim_ml: { min: 90 } })
  })
})
