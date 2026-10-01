/**
 * Guard for experimental.middlewareClientMaxBodySize in apps/seller-panel/next.config.ts.
 *
 * Next clones every non-GET request body matched by the middleware (seller panel:
 * `/api/:path*`) and, once the clone limit is exceeded, ends both the middleware copy
 * and the copy replayed to the route handler. Seller document, contract and invoice
 * uploads above the default 10 MiB therefore reached the route truncated and failed
 * multipart parsing (see .claude/rules/12-production-readiness.md §44).
 *
 * These tests drive Next's own body-cloning module, resolved from the seller panel's
 * `next` install, the same way the server does: clone for middleware, finalize, then
 * parse the replayed body as the route's NextRequest would. A Next upgrade that moves
 * or renames this module/setting (Next 16: `proxyClientMaxBodySize`) fails here first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  CONTRACT_MAX_TOTAL_SIZE_BYTES,
  DOCUMENT_MAX_SIZE_BYTES,
} from '../../api/services/seller-document.service'
import sellerPanelConfig from '../../apps/seller-panel/next.config'

const MiB = 1024 * 1024
const CHUNK_SIZE = 64 * 1024
// Mirrors MAX_MULTIPART_REQUEST_BYTES in the seller upload routes.
const CONTRACT_ROUTE_ENVELOPE = CONTRACT_MAX_TOTAL_SIZE_BYTES + 5 * MiB
const DOCUMENT_ROUTE_ENVELOPE = DOCUMENT_MAX_SIZE_BYTES + 1 * MiB

interface CloneableBody {
  finalize(): Promise<void>
  cloneBodyStream(): Readable
}

const sellerPanelPackageJson = fileURLToPath(
  new URL('../../apps/seller-panel/package.json', import.meta.url),
)
const { getCloneableBody } = createRequire(sellerPanelPackageJson)(
  'next/dist/server/body-streams',
) as { getCloneableBody: (readable: Readable, sizeLimit?: number) => CloneableBody }

function configuredLimit(): number {
  const limit = sellerPanelConfig.experimental?.middlewareClientMaxBodySize
  if (typeof limit !== 'number') throw new Error('seller panel must set a numeric clone limit')
  return limit
}

async function buildMultipartUpload(fileBytes: Uint8Array) {
  const form = new FormData()
  form.set('type', 'contract')
  form.set('file', new Blob([fileBytes], { type: 'application/pdf' }), 'contract.pdf')
  const encoded = new Request('http://localhost/encode', { method: 'POST', body: form })
  return {
    contentType: encoded.headers.get('content-type') ?? '',
    body: new Uint8Array(await encoded.arrayBuffer()),
  }
}

function requestStream(body: Uint8Array, url: string): Readable {
  const chunks: Buffer[] = []
  for (let offset = 0; offset < body.byteLength; offset += CHUNK_SIZE) {
    chunks.push(Buffer.from(body.subarray(offset, offset + CHUNK_SIZE)))
  }
  return Object.assign(Readable.from(chunks), { url })
}

async function drain(stream: Readable) {
  for await (const _chunk of stream) {
    // The middleware copy is consumed like Next's requestToBodyStream does.
  }
}

/** Middleware clone → finalize → route parses the replayed original request body. */
async function routeFormDataAfterMiddleware(
  upload: { contentType: string; body: Uint8Array },
  sizeLimit: number | undefined,
) {
  const original = requestStream(upload.body, '/api/seller/documents')
  const cloneable = getCloneableBody(original, sizeLimit)
  await drain(cloneable.cloneBodyStream())
  await cloneable.finalize()

  return new Request('http://localhost/api/seller/documents', {
    method: 'POST',
    headers: { 'content-type': upload.contentType },
    // NextRequestAdapter.fromNodeNextRequest hands the Node request stream to undici as-is.
    body: original as unknown as RequestInit['body'],
    duplex: 'half',
  } as RequestInit & { duplex: 'half' }).formData()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('seller panel middleware body clone limit', () => {
  it('sits above the largest seller upload route envelope', () => {
    const limit = configuredLimit()

    expect(limit).toBeGreaterThan(CONTRACT_ROUTE_ENVELOPE)
    expect(limit).toBeGreaterThan(DOCUMENT_ROUTE_ENVELOPE)
  })

  it('truncates a 12 MiB upload at the Next default limit (the original defect)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const upload = await buildMultipartUpload(new Uint8Array(12 * MiB))

    await expect(routeFormDataAfterMiddleware(upload, undefined)).rejects.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Request body exceeded 10MB'))
  })

  it('delivers a 12 MiB upload intact with the configured limit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fileBytes = new Uint8Array(12 * MiB)
    fileBytes.set(Buffer.from('%PDF-1.4\n', 'ascii'))
    fileBytes[fileBytes.length - 1] = 0x2a
    const upload = await buildMultipartUpload(fileBytes)

    const formData = await routeFormDataAfterMiddleware(upload, configuredLimit())
    const file = formData.get('file')

    expect(formData.get('type')).toBe('contract')
    expect(file).toBeInstanceOf(File)
    const received = new Uint8Array(await (file as File).arrayBuffer())
    expect(received.byteLength).toBe(fileBytes.byteLength)
    expect(received.subarray(0, 9)).toEqual(fileBytes.subarray(0, 9))
    expect(received[received.length - 1]).toBe(0x2a)
    expect(warn).not.toHaveBeenCalled()
  })
})
