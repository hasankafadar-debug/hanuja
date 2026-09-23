/**
 * File signature ("magic byte") checks for uploads whose declared Content-Type must
 * match the bytes. The presigned PUT only signs the Content-Type header, so the
 * header alone says nothing about what was actually uploaded.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3]

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

export function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') return startsWith(bytes, PNG_SIGNATURE)
  if (mimeType === 'image/jpeg') return startsWith(bytes, JPEG_SIGNATURE)
  return false
}

/** Needs the first 64 bytes: MP4 carries `ftyp` at offset 4, WebM an EBML header with doctype `webm`. */
export function hasVideoSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'video/mp4') return bytes.length >= 8 && ascii(bytes, 4, 4) === 'ftyp'
  if (mimeType === 'video/webm')
    return startsWith(bytes, EBML_SIGNATURE) && ascii(bytes, 0, Math.min(bytes.length, 64)).includes('webm')
  return false
}
