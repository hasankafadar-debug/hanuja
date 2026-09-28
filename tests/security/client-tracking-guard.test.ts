/**
 * Security/privacy guard — no tracking or new browser storage may reach the storefront
 * without going through the cookie consent system.
 *
 * The storefront currently uses only strictly necessary cookies, so the cookie notice runs
 * in info mode and asks for no consent. That is only true while nothing optional is loaded.
 * This test fails the moment a tracker, a `next/script` tag, or a new cookie/storage write
 * appears outside the allowlisted files, so the addition has to go through
 * api/lib/cookie-policy.ts (inventory + version) and apps/web/src/lib/cookie-consent/scripts.ts
 * (consent-gated loading). docs/08-legal/cookie-policy-notes.md
 */
import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SCANNED_DIRS = ['apps/web/src', 'packages/ui/src']

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.isFile() && /\.(tsx?|jsx?|mjs)$/.test(entry.name) ? [full] : []
    }),
  )
  return files.flat()
}

async function scannedFiles(): Promise<{ file: string; source: string }[]> {
  const files = (await Promise.all(SCANNED_DIRS.map((dir) => walk(path.join(ROOT, dir))))).flat()
  return Promise.all(
    files.map(async (file) => ({
      file: path.relative(ROOT, file).split(path.sep).join('/'),
      source: await readFile(file, 'utf8'),
    })),
  )
}

const TRACKER_PATTERNS: RegExp[] = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /\bgtag\s*\(/,
  /\bfbq\s*\(/,
  /connect\.facebook\.net/i,
  /clarity\.ms/i,
  /hotjar/i,
  /plausible\.io/i,
  /posthog/i,
  /@vercel\/(analytics|speed-insights)/,
  /mixpanel/i,
  /cdn\.segment\.com/i,
  /static\.cloudflareinsights\.com/i,
  /mc\.yandex/i,
  /analytics\.tiktok\.com/i,
  /snap\.licdn\.com/i,
  /doubleclick\.net/i,
]

/** Files allowed to touch each browser storage API. Keep this list short and justified. */
const STORAGE_ALLOWLIST: { pattern: RegExp; files: string[]; why: string }[] = [
  {
    pattern: /\b(localStorage|sessionStorage|indexedDB)\s*\./,
    files: ['apps/web/src/lib/cookie-consent/browser.ts'],
    why: 'cookie notice/consent keys (inventory: hanuja-cookie-notice, hanuja-cookie-consent)',
  },
  {
    pattern: /document\.cookie\s*=(?!=)/,
    files: ['apps/web/src/lib/cookie-consent/browser.ts'],
    why: 'deleting optional cookies on consent withdrawal',
  },
  {
    pattern: /\bcookies(\(\))?\.set\s*\(/,
    files: ['apps/web/src/middleware.ts'],
    why: 'CSRF cookies (inventory: hanuja-csrf, hanuja-csrf-mirror)',
  },
  {
    pattern: /['"`]set-cookie['"`]/i,
    files: [],
    why: 'hand-written Set-Cookie headers bypass the inventory',
  },
  {
    pattern: /from\s+['"]next\/script['"]/,
    files: [],
    why: 'optional scripts must be loaded by the consent provider',
  },
]

describe('storefront client tracking guard', () => {
  it('contains no analytics, advertising or tracking code', async () => {
    const offenders: string[] = []
    for (const { file, source } of await scannedFiles()) {
      for (const pattern of TRACKER_PATTERNS) {
        if (pattern.test(source)) offenders.push(`${file}: ${pattern}`)
      }
    }
    expect(
      offenders,
      'İzleme/analitik kodu bulundu. Önce çerez envanterine ekleyip rıza modunu devreye alın (docs/08-legal/cookie-policy-notes.md).',
    ).toEqual([])
  })

  it('writes cookies and browser storage only from the allowlisted files', async () => {
    const files = await scannedFiles()
    const offenders: string[] = []
    for (const rule of STORAGE_ALLOWLIST) {
      for (const { file, source } of files) {
        if (rule.pattern.test(source) && !rule.files.includes(file)) {
          offenders.push(`${file}: ${rule.pattern} (${rule.why})`)
        }
      }
    }
    expect(
      offenders,
      'Yeni çerez/depolama kullanımı bulundu. Çerez envanterini (api/lib/cookie-policy.ts) güncelleyin, sürümü yükseltin ve bu izin listesini gerekçesiyle genişletin.',
    ).toEqual([])
  })

  it('keeps every allowlisted file present so the list cannot silently go stale', async () => {
    const files = new Set((await scannedFiles()).map(({ file }) => file))
    for (const rule of STORAGE_ALLOWLIST) {
      for (const file of rule.files) expect(files.has(file), file).toBe(true)
    }
  })
})
