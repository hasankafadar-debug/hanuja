import { ValidationError } from '../lib/errors'

/**
 * A model code groups colour/material siblings.  It deliberately differs from
 * SKU: SKU remains a seller-facing inventory reference and is not used to
 * decide what customers see as a single model.
 */
export function normalizeModelCode(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase()
}

export function requireModelCode(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? normalizeModelCode(value) : ''
  if (!normalized) throw new ValidationError('Model Kodu zorunludur.')
  if (normalized.length > 120) throw new ValidationError('Model Kodu en fazla 120 karakter olabilir.')
  return normalized
}
