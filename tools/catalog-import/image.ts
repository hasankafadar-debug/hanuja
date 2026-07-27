import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CachedImage } from './types'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 15_000

export function detectImageMimeType(body: Uint8Array): CachedImage['mimeType'] | undefined {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg'
  if (body.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => body[index] === byte)) return 'image/png'
  if (body.length >= 12 && new TextDecoder().decode(body.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(body.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

export function isPrivateIp(address: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)
    if (octets.some((value) => value > 255)) return true
    const [a, b] = octets
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice('::ffff:'.length))
  return ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')
}

export async function assertSafeExternalUrl(value: string): Promise<URL> {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Image URL is invalid.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Image URL must be public http(s).')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateIp(host)) throw new Error('Image URL points to a private host.')
  const addresses = await lookup(host, { all: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error('Image URL resolves to a private address.')
  return url
}

export async function readLimitedImageBody(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error('Image response has no body.')
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  while (true) {
    const next = await reader.read(); if (next.done) break
    size += next.value.byteLength
    if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('Image exceeds 10 MB.') }
    chunks.push(next.value)
  }
  const body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}

export async function fetchAndCacheImage(sourceUrl: string, cacheDir: string): Promise<CachedImage> {
  let current = await assertSafeExternalUrl(sourceUrl)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'Hanuja-Catalog-Import/1.0' } })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location || redirects === 3) throw new Error('Image redirect limit exceeded.')
        current = await assertSafeExternalUrl(new URL(location, current).toString())
        continue
      }
      if (!response.ok) throw new Error(`Image download returned HTTP ${response.status}.`)
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MB.')
      const body = await readLimitedImageBody(response)
      if (!body.byteLength || body.byteLength > MAX_IMAGE_BYTES) throw new Error('Image size is outside the allowed range.')
      const mimeType = detectImageMimeType(body)
      if (!mimeType) throw new Error('Image signature is not JPEG, PNG, or WebP.')
      const sha256 = createHash('sha256').update(body).digest('hex')
      const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp'
      const cachePath = path.resolve(cacheDir, `${sha256}.${extension}`)
      await fs.mkdir(cacheDir, { recursive: true })
      try { await fs.access(cachePath) } catch { await fs.writeFile(cachePath, body) }
      return { sourceUrl, cachePath, sha256, mimeType, sizeBytes: body.byteLength }
    } finally { clearTimeout(timer) }
  }
  throw new Error('Image redirect limit exceeded.')
}

export async function readVerifiedCache(image: CachedImage): Promise<Uint8Array> {
  const body = new Uint8Array(await fs.readFile(image.cachePath))
  if (body.byteLength !== image.sizeBytes || createHash('sha256').update(body).digest('hex') !== image.sha256 || detectImageMimeType(body) !== image.mimeType) throw new Error('Cached image hash or MIME verification failed.')
  return body
}
