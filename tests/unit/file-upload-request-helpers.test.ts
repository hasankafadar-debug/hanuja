import { afterEach, describe, expect, it } from 'vitest'
import {
  csrfHeadersForSameOrigin,
  R2_UPLOAD_NETWORK_ERROR_MESSAGE,
  sanitizeUploadError,
  uploadErrorMessage,
} from '../../packages/ui/src/components/composite/file-upload'

const browserGlobals = globalThis as typeof globalThis & {
  window?: { location: { origin: string } }
  document?: { cookie: string }
}
const originalWindow = browserGlobals.window
const originalDocument = browserGlobals.document

afterEach(() => {
  browserGlobals.window = originalWindow
  browserGlobals.document = originalDocument
})

describe('FileUpload request helpers', () => {
  it('adds the CSRF mirror cookie only to same-origin API requests', () => {
    browserGlobals.window = { location: { origin: 'https://satici.hanuja.com.tr' } }
    browserGlobals.document = { cookie: 'theme=dark; hanuja-csrf-mirror=csrf%2Btoken%3D1' }

    expect(csrfHeadersForSameOrigin('/api/media').get('x-csrf-token')).toBe('csrf+token=1')
    expect(csrfHeadersForSameOrigin('https://storage.example.test/upload').get('x-csrf-token')).toBeNull()
  })

  it('uses the presign API error message instead of a generic upload URL error', async () => {
    const response = new Response(JSON.stringify({ message: 'Oturum doğrulaması başarısız.' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })

    await expect(uploadErrorMessage(response, 'Yükleme URL’si alınamadı.')).resolves.toBe(
      'Oturum doğrulaması başarısız.',
    )
  })

  it('redacts presigned upload URLs and credentials from direct-upload diagnostics', () => {
    const error = new TypeError(
      'Failed to fetch https://storage.example.test/object?X-Amz-Signature=secret-signature&token=secret-token',
    )

    expect(sanitizeUploadError(error)).toEqual({ name: 'TypeError', message: 'Failed to fetch [URL]' })
    expect(sanitizeUploadError(new Error('credential: secret-value; token=another-secret')).message).toBe(
      'credential=[REDACTED]; token=[REDACTED]',
    )
    expect(R2_UPLOAD_NETWORK_ERROR_MESSAGE).toContain('Ağ, CORS engeli veya sunucu yapılandırmasını')
  })
})
