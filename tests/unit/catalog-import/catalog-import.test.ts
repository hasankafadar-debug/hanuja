import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { detectImageMimeType, isPrivateIp, MAX_IMAGE_BYTES, readLimitedImageBody } from '../../../tools/catalog-import/image'
import { mapCategory } from '../../../tools/catalog-import/mapping'
import { parseLocaleNumber, parseStock, splitImageUrls, stableHash } from '../../../tools/catalog-import/normalize'
import { discoverWorkbook, normalizeWorkbook } from '../../../tools/catalog-import/workbook'
import { manifestGuardErrors } from '../../../tools/catalog-import/runner'
import type { ImportProfile } from '../../../tools/catalog-import/types'

const hipicon: ImportProfile = {
  name: 'hipicon',
  imageHeaderAliases: ['image urls', 'fotoğraflar'],
  categoryRules: [
    { contains: 'orta sehpa', path: ['Ev', 'Mobilya', 'Sehpa Modelleri', 'Orta Sehpa'] },
    { contains: 'yan sehpa', path: ['Ev', 'Mobilya', 'Sehpa Modelleri', 'Yan Sehpa'] },
    { contains: 'dresuar', path: ['Ev', 'Mobilya', 'Dresuar & Konsol', 'Dresuar'] },
    { contains: 'kitaplık', path: ['Ev', 'Mobilya', 'Kitaplık'] },
    { contains: 'vitrin', path: ['Ev', 'Mobilya', 'Vitrin & Büfe'] },
    { contains: 'ayna', path: ['Ev', 'Ev Dekorasyon', 'Ayna'] },
  ],
}

async function fixture(rows = 1) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-import-'))
  const file = path.join(dir, 'source.xlsx'); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Ürünler')
  sheet.addRow(['not a header']); sheet.addRow(['Model Kodu', 'Ürün Adı', 'Kategori', 'Fiyat', 'Sevk Süresi', 'Stok', 'Fotoğraflar'])
  for (let index = 0; index < rows; index += 1) {
    const third = index < 74 ? `; https://images.example/${index}.png` : ''
    sheet.addRow([`M-${index}`, `Ürün ${index}`, 'Orta Sehpa', '1.234,50', '7', 'Stokta', `https://images.example/${index}.jpg; https://images.example/${index}.webp${third}`])
  }
  await workbook.xlsx.writeFile(file)
  return file
}

describe('catalog import workbook normalization', () => {
  it('scores a header in the first 15 rows and normalizes localized Mosaiss-style rows', async () => {
    const file = await fixture(92); const normalized = await normalizeWorkbook(file, hipicon)
    expect(normalized.rows).toHaveLength(92)
    expect(normalized.rows[0]).toMatchObject({ sourceRow: 3, price: 1234.5, fulfillmentDays: 7, stockQuantity: 10, canonicalCategoryPath: ['Ev', 'Mobilya', 'Sehpa Modelleri', 'Orta Sehpa'] })
    expect(normalized.rows.reduce((count, row) => count + row.imageUrls.length, 0)).toBe(258)
    expect(normalized.sourceHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('blocks an equally-scored sheet mapping', async () => {
    const file = await fixture(); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file); const duplicate = workbook.addWorksheet('Kopya'); duplicate.addRow(['Model Kodu', 'Ürün Adı', 'Kategori', 'Fiyat', 'Sevk Süresi', 'Stok', 'Fotoğraflar']); duplicate.addRow(['M', 'Ürün', 'Ayna', 10, 2, 1, 'https://images.example/a.jpg']); await workbook.xlsx.writeFile(file)
    const report = await discoverWorkbook(file, hipicon)
    expect(report.blockingErrors).toContain('Header mapping is ambiguous; use an explicit profile override.')
  })
})

describe('catalog import pure safety rules', () => {
  it('normalizes locale values, stock and deterministic hashes', () => {
    expect(parseLocaleNumber('1.234,50')).toBe(1234.5); expect(parseLocaleNumber('$1,234.50')).toBe(1234.5); expect(parseStock('Stokta')).toBe(10); expect(parseStock('In stock', { 'In stock': 10 })).toBe(10)
    expect(stableHash({ b: 1, a: [2] })).toBe(stableHash({ a: [2], b: 1 }))
    expect(splitImageUrls('ignore https://a.test/x.jpg, https://b.test/y.webp')).toEqual(['https://a.test/x.jpg', 'https://b.test/y.webp'])
  })

  it('uses the approved Mosaiss category paths and refuses ambiguous matches', () => {
    expect(mapCategory('Metal Orta Sehpa', hipicon)).toEqual(['Ev', 'Mobilya', 'Sehpa Modelleri', 'Orta Sehpa'])
    expect(mapCategory('Bilinmeyen', hipicon)).toBeUndefined()
    expect(mapCategory('Vitrin Ayna', hipicon)).toBeUndefined()
  })

  it('recognizes image signatures and blocks private IPv4/IPv6 ranges', () => {
    expect(detectImageMimeType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    expect(detectImageMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '::1', '::ffff:10.0.0.1']) expect(isPrivateIp(address)).toBe(true)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
  })

  it('stops an image stream at the 10 MB limit when no Content-Length is supplied', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close() } }))
    await expect(readLimitedImageBody(response)).rejects.toThrow('Image exceeds 10 MB.')
  })

  it('blocks expired, changed, or wrongly confirmed manifests before apply', () => {
    const manifest = { expiresAt: '2026-01-01T00:00:00.000Z', normalizedHash: 'same', seller: { slug: 'mosaiss' } } as Parameters<typeof manifestGuardErrors>[0]
    expect(manifestGuardErrors(manifest, { confirmStore: 'other', normalizedHash: 'changed', now: new Date('2027-01-01') })).toHaveLength(3)
    expect(manifestGuardErrors(manifest, { confirmStore: 'mosaiss', normalizedHash: 'same', now: new Date('2025-01-01') })).toEqual([])
  })
})
