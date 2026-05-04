export interface ParsedImageMetadata {
  width: number
  height: number
  dpi: number | null
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function isPng(bytes: Uint8Array) {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value)
}

function readAscii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

function readRational(view: DataView, absoluteOffset: number, littleEndian: boolean) {
  const numerator = view.getUint32(absoluteOffset, littleEndian)
  const denominator = view.getUint32(absoluteOffset + 4, littleEndian)
  if (!denominator) return null
  return numerator / denominator
}

function parsePngMetadata(bytes: Uint8Array): ParsedImageMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)
  let dpi: number | null = null
  let offset = 8

  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false)
    const type = readAscii(bytes, offset + 4, 4)
    const dataOffset = offset + 8

    if (type === 'pHYs' && length >= 9) {
      const pixelsPerUnitX = view.getUint32(dataOffset, false)
      const pixelsPerUnitY = view.getUint32(dataOffset + 4, false)
      const unit = bytes[dataOffset + 8]

      if (unit === 1) {
        const dpiX = pixelsPerUnitX * 0.0254
        const dpiY = pixelsPerUnitY * 0.0254
        dpi = Number(((dpiX + dpiY) / 2).toFixed(2))
      }
      break
    }

    offset += length + 12
  }

  return { width, height, dpi }
}

function parseExifDpi(bytes: Uint8Array, segmentOffset: number, segmentLength: number) {
  if (segmentLength < 14) return null
  if (readAscii(bytes, segmentOffset, 4) !== 'Exif') return null

  const tiffOffset = segmentOffset + 6
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const byteOrder = readAscii(bytes, tiffOffset, 2)
  const littleEndian = byteOrder === 'II'
  if (!littleEndian && byteOrder !== 'MM') return null

  const ifdOffset = view.getUint32(tiffOffset + 4, littleEndian)
  const directoryOffset = tiffOffset + ifdOffset
  if (directoryOffset + 2 > bytes.byteLength) return null

  const entries = view.getUint16(directoryOffset, littleEndian)
  let resolutionUnit = 2
  let xResolution: number | null = null
  let yResolution: number | null = null

  for (let index = 0; index < entries; index += 1) {
    const entryOffset = directoryOffset + 2 + index * 12
    if (entryOffset + 12 > bytes.byteLength) break

    const tag = view.getUint16(entryOffset, littleEndian)
    const type = view.getUint16(entryOffset + 2, littleEndian)
    const count = view.getUint32(entryOffset + 4, littleEndian)
    const valueOffset = view.getUint32(entryOffset + 8, littleEndian)

    if (tag === 0x0128 && type === 3) {
      resolutionUnit = littleEndian
        ? view.getUint16(entryOffset + 8, true)
        : view.getUint16(entryOffset + 8, false)
    }

    if ((tag === 0x011a || tag === 0x011b) && type === 5 && count >= 1) {
      const rationalOffset = tiffOffset + valueOffset
      if (rationalOffset + 8 > bytes.byteLength) continue
      const value = readRational(view, rationalOffset, littleEndian)
      if (value == null) continue
      if (tag === 0x011a) xResolution = value
      if (tag === 0x011b) yResolution = value
    }
  }

  const resolution = xResolution ?? yResolution
  if (!resolution) return null
  if (resolutionUnit === 3) return Number((resolution * 2.54).toFixed(2))
  return Number(resolution.toFixed(2))
}

function parseJpegMetadata(bytes: Uint8Array): ParsedImageMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  let width = 0
  let height = 0
  let dpi: number | null = null

  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = bytes[offset + 1] ?? 0
    offset += 2

    if (marker === 0xd8 || marker === 0xd9) continue
    if (marker === 0xda) break
    if (offset + 2 > bytes.byteLength) break

    const segmentLength = view.getUint16(offset, false)
    if (segmentLength < 2) break

    const segmentOffset = offset + 2
    const segmentEnd = segmentOffset + segmentLength - 2
    if (segmentEnd > bytes.byteLength) break

    if (marker === 0xe0 && segmentLength >= 14 && readAscii(bytes, segmentOffset, 5) === 'JFIF\u0000') {
      const unit = bytes[segmentOffset + 7]
      const densityX = view.getUint16(segmentOffset + 8, false)
      const densityY = view.getUint16(segmentOffset + 10, false)
      const density = densityX || densityY

      if (density) {
        if (unit === 1) dpi = density
        if (unit === 2) dpi = Number((density * 2.54).toFixed(2))
      }
    }

    if (marker === 0xe1 && dpi == null) {
      dpi = parseExifDpi(bytes, segmentOffset, segmentLength - 2)
    }

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      height = view.getUint16(segmentOffset + 1, false)
      width = view.getUint16(segmentOffset + 3, false)
    }

    offset += segmentLength
  }

  return { width, height, dpi }
}

export function parseImageMetadata(bytes: Uint8Array, mimeType: string): ParsedImageMetadata {
  if (mimeType === 'image/png' || isPng(bytes)) {
    return parsePngMetadata(bytes)
  }

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return parseJpegMetadata(bytes)
  }

  throw new Error('Yalnızca PNG veya JPEG kabul edilir.')
}
