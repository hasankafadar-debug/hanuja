/**
 * Unit tests — slug.ts
 * Turkish-aware URL slug normalization and validation.
 * docs/04-seo/seo-url-slug-rules.md
 */
import { describe, it, expect } from 'vitest'
import { buildSlugWithSuffix, normalizeSlug, isValidSlug } from '../../../api/domain/slug'

describe('normalizeSlug', () => {
  it('converts Turkish characters correctly', () => {
    expect(normalizeSlug('ğüşıöç')).toBe('gusioc')
    expect(normalizeSlug('ĞÜŞIÖÇ')).toBe('gusioc') // uppercase Turkish
    expect(normalizeSlug('İstanbul')).toBe('istanbul')
    expect(normalizeSlug('Şişli')).toBe('sisli')
  })

  it('lowercases ASCII letters', () => {
    expect(normalizeSlug('MobilYa')).toBe('mobilya')
    expect(normalizeSlug('DEKOR')).toBe('dekor')
  })

  it('replaces spaces and special chars with hyphens', () => {
    expect(normalizeSlug('masif meşe sehpa')).toBe('masif-mese-sehpa')
    expect(normalizeSlug('ürün  adı!')).toBe('urun-adi')
  })

  it('collapses multiple separators into one hyphen', () => {
    expect(normalizeSlug('a   b')).toBe('a-b')
    expect(normalizeSlug('a---b')).toBe('a-b')
    expect(normalizeSlug('a!@#b')).toBe('a-b')
  })

  it('strips leading and trailing hyphens', () => {
    expect(normalizeSlug('  ürün  ')).toBe('urun')
    expect(normalizeSlug('-test-')).toBe('test')
  })

  it('allows digits', () => {
    expect(normalizeSlug('sehpa-2024')).toBe('sehpa-2024')
    expect(normalizeSlug('3lü set')).toBe('3lu-set')
  })

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(100)
    expect(normalizeSlug(long).length).toBeLessThanOrEqual(80)
  })

  it('handles real product names', () => {
    expect(normalizeSlug('Masif Meşe Orta Sehpa')).toBe('masif-mese-orta-sehpa')
    expect(normalizeSlug('Bambu Raf Sistemi')).toBe('bambu-raf-sistemi')
    expect(normalizeSlug('Rattan Konsol Aynalı')).toBe('rattan-konsol-aynali')
    expect(normalizeSlug('Keten Kırlent Seti')).toBe('keten-kirlent-seti')
  })

  it('handles store names', () => {
    expect(normalizeSlug('Atelier Noa')).toBe('atelier-noa')
    expect(normalizeSlug('WoodForm Design')).toBe('woodform-design')
    expect(normalizeSlug('Bohem Atölye')).toBe('bohem-atolye')
  })

  it('handles category names', () => {
    expect(normalizeSlug('Mobilya')).toBe('mobilya')
    expect(normalizeSlug('Aydınlatma')).toBe('aydinlatma')
    expect(normalizeSlug('Ev Tekstili')).toBe('ev-tekstili')
  })
})

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidSlug('masif-mese-sehpa')).toBe(true)
    expect(isValidSlug('atelier-noa')).toBe(true)
    expect(isValidSlug('kategori-123')).toBe(true)
    expect(isValidSlug('abc')).toBe(true) // min length 3 (regex: start + middle{1,78} + end)
  })

  it('rejects slugs with uppercase letters', () => {
    expect(isValidSlug('Masif-Mese')).toBe(false)
    expect(isValidSlug('DEKOR')).toBe(false)
  })

  it('rejects slugs with Turkish characters', () => {
    expect(isValidSlug('ürün')).toBe(false)
    expect(isValidSlug('mobilya-ğ')).toBe(false)
  })

  it('rejects slugs starting or ending with hyphen', () => {
    expect(isValidSlug('-test')).toBe(false)
    expect(isValidSlug('test-')).toBe(false)
  })

  it('rejects slugs shorter than 3 characters', () => {
    expect(isValidSlug('a')).toBe(false)
    expect(isValidSlug('ab')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false)
  })

  it('rejects slugs with spaces', () => {
    expect(isValidSlug('masif mese')).toBe(false)
  })

  it('rejects slugs with special characters', () => {
    expect(isValidSlug('ürün!')).toBe(false)
    expect(isValidSlug('test.slug')).toBe(false)
    expect(isValidSlug('test/slug')).toBe(false)
  })

  it('accepts slugs with numbers', () => {
    expect(isValidSlug('sehpa-2024')).toBe(true)
    expect(isValidSlug('3lu-set')).toBe(true)
  })
})

describe('buildSlugWithSuffix', () => {
  it('returns the base slug for the first candidate', () => {
    expect(buildSlugWithSuffix('masif-mese-sehpa', 1)).toBe('masif-mese-sehpa')
  })

  it('appends numeric suffixes for later candidates', () => {
    expect(buildSlugWithSuffix('masif-mese-sehpa', 2)).toBe('masif-mese-sehpa-2')
    expect(buildSlugWithSuffix('masa', 5)).toBe('masa-5')
  })

  it('truncates long slugs before appending suffixes', () => {
    const longSlug = 'a'.repeat(80)
    const suffixed = buildSlugWithSuffix(longSlug, 12)
    expect(suffixed.length).toBeLessThanOrEqual(80)
    expect(suffixed.endsWith('-12')).toBe(true)
  })
})
