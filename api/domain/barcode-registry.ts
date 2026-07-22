import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { ConflictError, ValidationError } from '../lib/errors'

type BarcodeRegistryClient = Pick<PrismaClient, 'barcodeRegistry'>
type BarcodeReplacementClient = Pick<PrismaClient, 'barcodeRegistry' | 'productVariant'>

export function requireBarcode(value: string | null | undefined): string {
  const barcode = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{13}$/.test(barcode)) {
    throw new ValidationError('Barkod 13 haneli rakam olmalidir.')
  }
  return barcode
}

function isRegistryConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002',
  )
}

/** Reserve a barcode in the same transaction as the owning product write. */
export async function syncProductBarcodeReservation(
  prisma: BarcodeRegistryClient,
  productId: string,
  barcode: string | null | undefined,
) {
  await prisma.barcodeRegistry.deleteMany({ where: { productId } })
  if (!barcode) return

  try {
    await prisma.barcodeRegistry.create({
      data: { barcode: requireBarcode(barcode), productId },
    })
  } catch (error) {
    if (isRegistryConflict(error)) throw new ConflictError('Bu barkod başka bir ürün veya varyantta kullanılmıştır.')
    throw error
  }
}

/** Reserve a barcode in the same transaction as the owning variant write. */
export async function syncVariantBarcodeReservation(
  prisma: BarcodeRegistryClient,
  variantId: string,
  barcode: string,
) {
  await prisma.barcodeRegistry.deleteMany({ where: { variantId } })
  try {
    await prisma.barcodeRegistry.create({
      data: { barcode: requireBarcode(barcode), variantId },
    })
  } catch (error) {
    if (isRegistryConflict(error)) throw new ConflictError('Bu barkod başka bir ürün veya varyantta kullanılmıştır.')
    throw error
  }
}

function temporaryBarcode(finalBarcodes: Set<string>): string {
  // A 12-digit random suffix gives a 10^12 namespace.  It is only stored
  // inside the enclosing transaction and never returned to a client.
  const decimal = parseInt(randomUUID().replace(/-/g, '').slice(0, 12), 16) % 1_000_000_000_000
  const barcode = `9${decimal.toString().padStart(12, '0')}`
  return finalBarcodes.has(barcode) ? temporaryBarcode(finalBarcodes) : barcode
}

/**
 * Makes a product's current variants safe to replace in-place.  This permits
 * barcode swaps and a variant-to-product barcode promotion without violating
 * either the legacy unique indexes or BarcodeRegistry halfway through a write.
 */
export async function prepareVariantBarcodeReplacement(
  prisma: BarcodeReplacementClient,
  productId: string,
  finalBarcodes: Iterable<string>,
) {
  const finalSet = new Set(finalBarcodes)
  const variants = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true },
  })

  await prisma.barcodeRegistry.deleteMany({
    where: { OR: [{ productId }, { variant: { productId } }] },
  })

  for (const variant of variants) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const barcode = temporaryBarcode(finalSet)
      try {
        await prisma.productVariant.update({ where: { id: variant.id }, data: { barcode } })
        break
      } catch (error) {
        if (!isRegistryConflict(error) || attempt === 19) throw error
      }
    }
  }

  return variants
}

export function isBarcodeConflict(error: unknown): boolean {
  return isRegistryConflict(error)
}
