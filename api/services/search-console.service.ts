import crypto from 'node:crypto'
import type { SearchDemandSignal } from '../domain/seo-topic-cluster'

const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

let cachedToken: { accessToken: string; expiresAt: number } | null = null

export interface SearchConsoleQueryOptions {
  startDate: Date
  endDate: Date
  rowLimit?: number
}

export function createSearchConsoleService() {
  async function listQuerySignals(
    options: SearchConsoleQueryOptions,
  ): Promise<SearchDemandSignal[]> {
    const siteUrl = process.env['GOOGLE_SEARCH_CONSOLE_SITE_URL']?.trim()
    if (!siteUrl) return []

    const accessToken = await getAccessToken()
    if (!accessToken) return []

    const response = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: toDateOnly(options.startDate),
          endDate: toDateOnly(options.endDate),
          dimensions: ['query'],
          rowLimit: options.rowLimit ?? 500,
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Search Console query failed: ${response.status} ${await response.text()}`)
    }

    const payload = (await response.json()) as {
      rows?: Array<{
        keys?: string[]
        clicks?: number
        impressions?: number
        position?: number
      }>
    }

    const signals: SearchDemandSignal[] = []
    for (const row of payload.rows ?? []) {
      const query = row.keys?.[0]?.trim()
      if (!query) continue
      signals.push({
        source: 'gsc',
        query,
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        position: row.position ?? 99,
      })
    }

    return signals
  }

  return { listQuerySignals }
}

async function getAccessToken(): Promise<string | null> {
  const directAccessToken = process.env['GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN']?.trim()
  if (directAccessToken) return directAccessToken

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken
  }

  const clientEmail = process.env['GOOGLE_SERVICE_ACCOUNT_EMAIL']?.trim()
  const privateKey = process.env['GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY']?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) return null

  const issuedAt = Math.floor(Date.now() / 1000)
  const assertion = signJwt(
    {
      alg: 'RS256',
      typ: 'JWT',
    },
    {
      iss: clientEmail,
      scope: SEARCH_CONSOLE_SCOPE,
      aud: TOKEN_URL,
      exp: issuedAt + 3600,
      iat: issuedAt,
    },
    privateKey,
  )

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!response.ok) {
    throw new Error(`Search Console token failed: ${response.status} ${await response.text()}`)
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!payload.access_token) return null

  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  }

  return cachedToken.accessToken
}

function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: string,
): string {
  const encodedHeader = base64Url(JSON.stringify(header))
  const encodedPayload = base64Url(JSON.stringify(payload))
  const unsigned = `${encodedHeader}.${encodedPayload}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const signature = signer.sign(privateKey)
  return `${unsigned}.${base64Url(signature)}`
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}
