import { randomUUID } from 'node:crypto'
import { resolve4, resolve6 } from 'node:dns/promises'
import { request } from 'node:https'
import type { TLSSocket } from 'node:tls'

const HOSTNAME = 'challenges.cloudflare.com'
const PATH = '/turnstile/v0/siteverify'
const TEST_SECRET = '1x0000000000000000000000000000000AA'
const TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const TIMEOUT_MS = 4_000
const RETRY_DELAYS_MS = [250, 500] as const
const MAX_ATTEMPTS = 3

type RequestedFamily = 0 | 4 | 6

interface ProbeResult {
  cfRay: string | null
  durationMs: number
  ipFamily: string
  ok: boolean
  status: number | null
  tlsAuthorized: boolean | null
}

function familyLabel(family: RequestedFamily): string {
  if (family === 4) return 'IPv4'
  if (family === 6) return 'IPv6'
  return 'auto'
}

function safeErrorClass(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown'
  const record = error as { code?: unknown; name?: unknown }
  if (typeof record.code === 'string') return record.code
  if (typeof record.name === 'string') return record.name
  return 'Error'
}

function safeHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function waitBeforeRetry(attempt: number): Promise<void> {
  const delay = RETRY_DELAYS_MS[attempt - 1]
  return delay ? new Promise((resolve) => setTimeout(resolve, delay)) : Promise.resolve()
}

async function logDnsState(): Promise<void> {
  try {
    const ipv4 = await resolve4(HOSTNAME)
    console.info('[turnstile-egress] DNS IPv4 resolved', {
      addressCount: ipv4.length,
    })
  } catch (error) {
    console.warn('[turnstile-egress] DNS IPv4 resolution failed', {
      errorClass: safeErrorClass(error),
    })
  }

  try {
    const ipv6 = await resolve6(HOSTNAME)
    console.info('[turnstile-egress] DNS IPv6 resolved', {
      addressCount: ipv6.length,
    })
  } catch (error) {
    console.warn('[turnstile-egress] DNS IPv6 resolution failed', {
      errorClass: safeErrorClass(error),
    })
  }
}

function verifyOnce(family: RequestedFamily, idempotencyKey: string): Promise<ProbeResult> {
  const body = new URLSearchParams({
    secret: TEST_SECRET,
    response: TEST_TOKEN,
    idempotency_key: idempotencyKey,
  }).toString()
  const startedAt = Date.now()

  return new Promise((resolve) => {
    const req = request(
      {
        family,
        headers: {
          'Content-Length': Buffer.byteLength(body),
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'hanuja-turnstile-egress-check/1.0',
        },
        hostname: HOSTNAME,
        method: 'POST',
        path: PATH,
        port: 443,
        servername: HOSTNAME,
      },
      (response) => {
        const chunks: Buffer[] = []
        const socket = response.socket as TLSSocket
        const remoteFamily = socket.remoteFamily || familyLabel(family)
        const tlsAuthorized = socket.authorized

        response.on('data', (chunk: Buffer) => {
          if (Buffer.concat(chunks).length < 64 * 1024) chunks.push(chunk)
        })
        response.on('end', () => {
          const status = response.statusCode ?? null
          const baseResult = {
            cfRay: safeHeader(response.headers['cf-ray']),
            durationMs: Date.now() - startedAt,
            ipFamily: remoteFamily,
            status,
            tlsAuthorized,
          }

          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              success?: boolean
            }
            resolve({
              ...baseResult,
              ok: Boolean(status && status >= 200 && status < 300 && payload.success),
            })
          } catch {
            resolve({ ...baseResult, ok: false })
          }
        })
      },
    )

    req.setTimeout(TIMEOUT_MS, () => {
      const timeoutError = Object.assign(new Error('Turnstile egress probe timed out'), {
        code: 'ETIMEDOUT',
      })
      req.destroy(timeoutError)
    })

    req.on('error', (error) => {
      console.warn('[turnstile-egress] request failed', {
        durationMs: Date.now() - startedAt,
        errorClass: safeErrorClass(error),
        requestedFamily: familyLabel(family),
      })
      resolve({
        cfRay: null,
        durationMs: Date.now() - startedAt,
        ipFamily: familyLabel(family),
        ok: false,
        status: null,
        tlsAuthorized: null,
      })
    })

    req.write(body)
    req.end()
  })
}

async function runProbe(family: RequestedFamily): Promise<boolean> {
  const idempotencyKey = randomUUID()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await verifyOnce(family, idempotencyKey)
    const log = result.ok ? console.info : console.warn
    log('[turnstile-egress] Siteverify probe result', {
      attempt,
      cfRay: result.cfRay,
      durationMs: result.durationMs,
      ipFamily: result.ipFamily,
      maxAttempts: MAX_ATTEMPTS,
      requestedFamily: familyLabel(family),
      status: result.status,
      tlsAuthorized: result.tlsAuthorized,
    })

    if (result.ok) return true
    if (attempt < MAX_ATTEMPTS) await waitBeforeRetry(attempt)
  }

  return false
}

async function main(): Promise<void> {
  const detailed = process.argv.includes('--detailed')
  await logDnsState()

  if (!detailed) {
    process.exitCode = (await runProbe(0)) ? 0 : 1
    return
  }

  const ipv4Ok = await runProbe(4)
  const ipv6Ok = await runProbe(6)

  console.info('[turnstile-egress] detailed summary', { ipv4Ok, ipv6Ok })
  process.exitCode = ipv4Ok || ipv6Ok ? 0 : 1
}

void main().catch((error) => {
  console.error('[turnstile-egress] probe crashed', {
    errorClass: safeErrorClass(error),
  })
  process.exitCode = 1
})
