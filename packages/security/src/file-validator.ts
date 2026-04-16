/**
 * File upload validation utilities.
 * All file uploads must pass these checks before being stored or processed.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
])

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
])

/** Max product image size: 8 MB */
export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024

/** Max dispute evidence file: 10 MB */
export const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024

// ── Result type ───────────────────────────────────────────────────────────────

export interface FileValidationResult {
  valid: boolean
  error?: string
}

// ── Validators ────────────────────────────────────────────────────────────────

export function validateProductImage(file: {
  mimeType: string
  sizeBytes: number
  name: string
}): FileValidationResult {
  if (!IMAGE_MIME_TYPES.has(file.mimeType)) {
    return {
      valid: false,
      error: `Desteklenmeyen dosya tipi: ${file.mimeType}. İzin verilenler: JPEG, PNG, WebP, AVIF`,
    }
  }

  if (file.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) {
    return {
      valid: false,
      error: `Dosya çok büyük (${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB). Maksimum: 8 MB`,
    }
  }

  if (containsPathTraversal(file.name)) {
    return { valid: false, error: 'Geçersiz dosya adı' }
  }

  return { valid: true }
}

export function validateEvidenceFile(file: {
  mimeType: string
  sizeBytes: number
  name: string
}): FileValidationResult {
  if (!DOCUMENT_MIME_TYPES.has(file.mimeType)) {
    return {
      valid: false,
      error: `Desteklenmeyen dosya tipi. İzin verilenler: PDF, JPEG, PNG`,
    }
  }

  if (file.sizeBytes > MAX_EVIDENCE_FILE_BYTES) {
    return {
      valid: false,
      error: `Dosya çok büyük. Maksimum: 10 MB`,
    }
  }

  if (containsPathTraversal(file.name)) {
    return { valid: false, error: 'Geçersiz dosya adı' }
  }

  return { valid: true }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function containsPathTraversal(name: string): boolean {
  return (
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.startsWith('.')
  )
}

/**
 * Sanitizes a file name to be safe for storage.
 * Strips path separators and non-alphanumeric characters except dots/dashes/underscores.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload'
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
}

/**
 * Checks that a storage key/path does not escape its intended prefix.
 * Use this before any read/write to R2.
 */
export function isStorageKeyAllowed(key: string, allowedPrefix: string): boolean {
  const normalized = key.replace(/\\/g, '/')
  return (
    normalized.startsWith(allowedPrefix) &&
    !normalized.includes('..') &&
    normalized === normalized.trim()
  )
}
