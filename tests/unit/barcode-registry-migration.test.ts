import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../db/schema/migrations/20260722140000_model_code_and_barcode_registry/migration.sql'),
  'utf8',
)

describe('barcode registry migration', () => {
  it('guards cross-owner conflicts before DDL and remains transactional', () => {
    expect(migration.trimStart().startsWith('BEGIN;')).toBe(true)
    expect(migration.indexOf('Cannot create barcode registry')).toBeLessThan(migration.indexOf('ALTER TABLE "products"'))
    expect(migration).toContain("REGEXP_REPLACE(BTRIM(\"sku\"), '[[:space:]]+', ' ', 'g')")
    expect(migration).toContain('CREATE TRIGGER "products_barcode_registry_sync"')
    expect(migration).toContain('CREATE TRIGGER "product_variants_barcode_registry_sync"')
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true)
  })
})
