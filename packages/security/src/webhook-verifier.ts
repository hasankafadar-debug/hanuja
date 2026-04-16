/**
 * Webhook signature verification utilities.
 * Providers send a signature in the request header; we verify it using HMAC-SHA256
 * to ensure the payload was not tampered with and came from the expected source.
 *
 * Node.js crypto is used — this runs server-side only (API routes / route handlers).
 */
import { createHmac, timingSafeEqual } from 'crypto'

// ── Core verifier ─────────────────────────────────────────────────────────────

export interface WebhookVerifyOptions {
  /** Raw request body as a string or Buffer */
  payload: string | Buffer
  /** Signature received in the request header */
  receivedSignature: string
  /** Secret used to sign the payload */
  secret: string
  /** Algorithm — defaults to sha256 */
  algorithm?: string
  /** Encoding of the expected signature — defaults to hex */
  encoding?: 'hex' | 'base64'
}

/**
 * Verifies a webhook HMAC signature using timing-safe comparison.
 * Returns true if the signature is valid, false otherwise.
 */
export function verifyWebhookSignature(options: WebhookVerifyOptions): boolean {
  const { payload, receivedSignature, secret, algorithm = 'sha256', encoding = 'hex' } = options

  try {
    const expected = createHmac(algorithm, secret)
      .update(payload)
      .digest(encoding)

    const expectedBuf = Buffer.from(expected, 'utf8')
    const receivedBuf = Buffer.from(receivedSignature, 'utf8')

    if (expectedBuf.length !== receivedBuf.length) return false

    return timingSafeEqual(expectedBuf, receivedBuf)
  } catch {
    return false
  }
}

// ── Iyzico-specific verifier ─────────────────────────────────────────────────

/**
 * Verifies an Iyzico payment webhook notification.
 * Iyzico sends: X-IYZ-Signature: HMAC-SHA256(merchantId + token, secretKey)
 */
export function verifyIyzicoWebhook(options: {
  merchantId: string
  token: string
  receivedSignature: string
  secretKey: string
}): boolean {
  const { merchantId, token, receivedSignature, secretKey } = options
  const payload = `${merchantId}${token}`
  return verifyWebhookSignature({
    payload,
    receivedSignature,
    secret: secretKey,
    encoding: 'base64',
  })
}

// ── Generic replay-attack guard ───────────────────────────────────────────────

const processedWebhookIds = new Set<string>()
const WEBHOOK_ID_TTL_MS = 30 * 60 * 1000 // 30 minutes
const webhookTimestamps = new Map<string, number>()

/**
 * Checks if a webhook ID has already been processed (idempotency guard).
 * Returns true if this is a duplicate (should be rejected).
 *
 * Note: For multi-instance deployments, replace with Redis SETNX.
 */
export function isDuplicateWebhook(webhookId: string): boolean {
  const now = Date.now()

  // Evict expired IDs
  for (const [id, ts] of webhookTimestamps.entries()) {
    if (now - ts > WEBHOOK_ID_TTL_MS) {
      processedWebhookIds.delete(id)
      webhookTimestamps.delete(id)
    }
  }

  if (processedWebhookIds.has(webhookId)) return true

  processedWebhookIds.add(webhookId)
  webhookTimestamps.set(webhookId, now)
  return false
}

// ── Timestamp freshness guard ─────────────────────────────────────────────────

/**
 * Checks that a webhook timestamp is within an acceptable window.
 * Rejects payloads that are too old (replay attack mitigation).
 */
export function isWebhookTimestampFresh(
  timestampSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return Math.abs(nowSeconds - timestampSeconds) <= toleranceSeconds
}
