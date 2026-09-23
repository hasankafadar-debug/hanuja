/**
 * File signature checks for announcement media: the presigned PUT only signs the
 * Content-Type header, so the bytes must match the declared type.
 */
import { describe, expect, it } from 'vitest'
import { hasImageSignature, hasVideoSignature } from '../../api/lib/media-signature'

const bytes = (...values: number[]) => new Uint8Array(values)
const ascii = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)))

describe('media signatures', () => {
  it('recognises PNG and JPEG only for their own declared type', () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)
    expect(hasImageSignature(png, 'image/png')).toBe(true)
    expect(hasImageSignature(jpeg, 'image/jpeg')).toBe(true)
    expect(hasImageSignature(png, 'image/jpeg')).toBe(false)
    expect(hasImageSignature(ascii('<html>'), 'image/png')).toBe(false)
    expect(hasImageSignature(png, 'image/webp')).toBe(false)
  })

  it('recognises MP4 by the ftyp box and WebM by its EBML doctype', () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x20, ...ascii('ftypisom'), 0, 0])
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, ...ascii('webm'), 0x42, 0x87])
    const matroska = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88, ...ascii('matroska')])
    expect(hasVideoSignature(mp4, 'video/mp4')).toBe(true)
    expect(hasVideoSignature(webm, 'video/webm')).toBe(true)
    expect(hasVideoSignature(matroska, 'video/webm')).toBe(false)
    expect(hasVideoSignature(webm, 'video/mp4')).toBe(false)
    expect(hasVideoSignature(ascii('<html><body>'), 'video/mp4')).toBe(false)
    expect(hasVideoSignature(bytes(0, 0, 0), 'video/mp4')).toBe(false)
  })
})
