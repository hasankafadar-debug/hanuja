/**
 * Security test — admin panel client calls must carry the CSRF token.
 *
 * Regression context: the bulk product approve action used a bare `fetch` while
 * its route enforced CSRF. Because Dockerfile.admin-panel pins
 * NODE_ENV=production, `checkCsrf` is unconditional there, so every request in
 * the batch returned 403 — and `Promise.allSettled` plus a missing `res.ok`
 * check meant the operator saw no error at all. It only reproduced in
 * production, since checkCsrf silently passes in dev without CSRF_STRICT.
 *
 * The third test below is the durable guard: it derives the CSRF-protected
 * routes from the route files themselves, so a future route that starts
 * enforcing CSRF automatically pulls its callers into scope.
 *
 * .claude/rules/05-security-rules.md, .claude/rules/11-testing-release-rules.md
 */
import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ADMIN_SRC = fileURLToPath(new URL('../../apps/admin-panel/src/', import.meta.url))
const ADMIN_API_DIR = path.join(ADMIN_SRC, 'app', 'api')

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : []
    }),
  )
  return files.flat()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `apps/admin-panel/src/app/api/admin/products/[id]/approve/route.ts`
 *   → matches `/api/admin/products/${id}/approve` in client source.
 */
function routeFileToUrlPattern(routeFile: string): RegExp {
  const relative = path.relative(ADMIN_API_DIR, routeFile).split(path.sep).slice(0, -1)
  const segments = relative.map((segment) => (segment.startsWith('[') ? '[^/`\'"]+' : escapeRegex(segment)))
  // The trailing guard must exclude `/` too, so `sellers/[id]/route.ts` does not
  // claim a call to the separate `sellers/[id]/commission` route.
  return new RegExp(`^/api/${segments.join('/')}(?![\\w\\-/])`)
}

// Matches `fetch('/x')` / `fetch("/x")` / fetch(`/x`) but never `csrfFetch(` —
// \b requires a lowercase `f`, and csrfFetch spells it with a capital F.
const BARE_FETCH_CALL = /\bfetch\(\s*[`'"]([^`'"]+)[`'"]/g

const BULK_APPROVE_ROUTE = fileURLToPath(
  new URL('../../apps/admin-panel/src/app/api/admin/products/bulk-approve/route.ts', import.meta.url),
)
const MODERATION_TABLE = fileURLToPath(
  new URL('../../apps/admin-panel/src/app/(panel)/urunler/_components/moderation-table-client.tsx', import.meta.url),
)
const CATALOG_ROUTE = fileURLToPath(new URL('../../api/routes/catalog.ts', import.meta.url))

describe('admin panel CSRF contract', () => {
  it('bulk product approve route enforces CSRF, session and admin role', async () => {
    const source = await readFile(BULK_APPROVE_ROUTE, 'utf8')

    expect(source).toContain('checkCsrf(req)')
    expect(source).toContain('auth.api.getSession')
    expect(source).toMatch(/session\.user\.role !== ['"]admin['"]/)
    // CSRF must be the first gate, before any session or business work.
    expect(source.indexOf('checkCsrf')).toBeLessThan(source.indexOf('getSession'))
  })

  it('bulk approve sends one CSRF-bearing request and reports the outcome', async () => {
    const source = await readFile(MODERATION_TABLE, 'utf8')

    expect(source).toContain('csrfFetch')
    expect(source).toContain('/api/admin/products/bulk-approve')
    // The original bug: failures were invisible because nothing checked the response.
    expect(source).toContain('response.ok')
    expect(source).not.toContain('payload.data')
    // The original fan-out must not come back.
    expect(source).not.toContain('Promise.allSettled')
    expect(source).not.toMatch(/\bfetch\(\s*[`'"]/)
  })

  it('bulk approve accepts only a bounded list of product CUIDs', async () => {
    const source = await readFile(CATALOG_ROUTE, 'utf8')

    expect(source).toContain('const BULK_APPROVE_MAX_IDS = 100')
    expect(source).toContain('z.array(z.string().cuid()).min(1).max(BULK_APPROVE_MAX_IDS)')
  })

  it('no admin client calls a CSRF-protected route with a bare fetch', async () => {
    const allFiles = await walk(ADMIN_SRC)

    const protectedPatterns = await Promise.all(
      allFiles
        .filter((file) => file.startsWith(ADMIN_API_DIR) && file.endsWith(`${path.sep}route.ts`))
        .map(async (file) => ({ file, source: await readFile(file, 'utf8') })),
    ).then((routes) =>
      routes.filter(({ source }) => source.includes('checkCsrf')).map(({ file }) => routeFileToUrlPattern(file)),
    )

    // Guard the guard: if this ever hits zero the test would pass vacuously.
    expect(protectedPatterns.length).toBeGreaterThan(0)

    const violations: string[] = []
    for (const file of allFiles.filter((candidate) => !candidate.startsWith(ADMIN_API_DIR))) {
      const source = await readFile(file, 'utf8')
      for (const match of source.matchAll(BARE_FETCH_CALL)) {
        const url = match[1]
        if (!url?.startsWith('/api/')) continue
        // A template hole stands in for a dynamic route segment.
        const normalized = url.replace(/\$\{[^}]*\}/g, 'DYNAMIC')
        if (protectedPatterns.some((pattern) => pattern.test(normalized))) {
          violations.push(`${path.relative(ADMIN_SRC, file)} → ${url}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
