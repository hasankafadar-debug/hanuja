import { describe, expect, it, vi } from 'vitest'
import {
  computeEan13CheckDigit,
  generateUniqueProductBarcode,
} from '../../api/domain/barcode-generate'
import { ConflictError, ValidationError } from '../../api/lib/errors'

function isValidEan13(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false
  return computeEan13CheckDigit(barcode.slice(0, 12)) === barcode[12]
}

/** Minimal barcodeRegistry stub matching the shape the generator reads. */
function registryStub(taken: Set<string>) {
  return {
    barcodeRegistry: {
      findUnique: vi.fn(async ({ where }: { where: { barcode: string } }) =>
        taken.has(where.barcode) ? { barcode: where.barcode } : null,
      ),
    },
  } as unknown as Parameters<typeof generateUniqueProductBarcode>[0]
}

describe('computeEan13CheckDigit', () => {
  it('computes the standard EAN-13 check digit', () => {
    // Known GS1 example: 400638133393 -> check digit 1
    expect(computeEan13CheckDigit('400638133393')).toBe('1')
    // 869000000000: (8+9)+(6*3) = 35 -> check digit 5
    expect(computeEan13CheckDigit('869000000000')).toBe('5')
  })

  it('rejects a body that is not 12 digits', () => {
    expect(() => computeEan13CheckDigit('123')).toThrow(ValidationError)
    expect(() => computeEan13CheckDigit('12345678901a')).toThrow(ValidationError)
  })
})

describe('generateUniqueProductBarcode', () => {
  it('produces a valid EAN-13 starting with 8', async () => {
    const barcode = await generateUniqueProductBarcode(registryStub(new Set()))
    expect(barcode).toMatch(/^8\d{12}$/)
    expect(isValidEan13(barcode)).toBe(true)
  })

  it('does not return a barcode already present in the used set', async () => {
    const used = new Set<string>()
    const first = await generateUniqueProductBarcode(registryStub(new Set()), { used })
    const second = await generateUniqueProductBarcode(registryStub(new Set()), { used })
    expect(first).not.toBe(second)
    expect(used.has(first)).toBe(true)
    expect(used.has(second)).toBe(true)
  })

  it('retries past barcodes already reserved in the registry', async () => {
    // Force the first candidate to be seen as taken, then accept the next.
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ barcode: 'taken' })
      .mockResolvedValue(null)
    const client = { barcodeRegistry: { findUnique } } as unknown as Parameters<
      typeof generateUniqueProductBarcode
    >[0]

    const barcode = await generateUniqueProductBarcode(client)
    expect(isValidEan13(barcode)).toBe(true)
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  it('throws when it cannot find a free barcode', async () => {
    // Every lookup reports the candidate as taken.
    const client = {
      barcodeRegistry: { findUnique: vi.fn(async () => ({ barcode: 'x' })) },
    } as unknown as Parameters<typeof generateUniqueProductBarcode>[0]

    await expect(generateUniqueProductBarcode(client)).rejects.toBeInstanceOf(ConflictError)
  })
})
