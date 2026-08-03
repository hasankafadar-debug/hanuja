/**
 * HNJ-SEC-008 deliberately protects the step-up-less admin mutations below.
 * Routes that consume a one-use `x-step-up-token` are recorded separately:
 * step-up is an additional intent proof, not a substitute for this CSRF pass.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { checkCsrf } from '../../api/lib/csrf-check'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

type TargetMutation = {
  route: string
  client: string
  clientScope: string
  url: string
  stepUp: 'none' | 'required'
  status: 'protected' | 'unresolved'
}

const HNJ_SEC_008_TARGETS: TargetMutation[] = [
  {
    route: 'apps/admin-panel/src/app/api/admin/penalties/[id]/route.ts',
    client: 'apps/admin-panel/src/components/edit-invoice-dialog.tsx',
    clientScope: 'export function EditPenaltyDialog',
    url: '`/api/admin/penalties/${penaltyId}`',
    stepUp: 'none',
    status: 'protected',
  },
  {
    route: 'apps/admin-panel/src/app/api/admin/platform-settings/route.ts',
    client: 'apps/admin-panel/src/app/(panel)/ayarlar/_components/platform-settings-form.tsx',
    clientScope: 'export function PlatformSettingsForm',
    url: "'/api/admin/platform-settings'",
    stepUp: 'none',
    status: 'protected',
  },
  {
    route: 'apps/admin-panel/src/app/api/admin/reviews/[id]/moderate/route.ts',
    client: 'apps/admin-panel/src/app/(panel)/yorumlar/_components/moderate-actions.tsx',
    clientScope: 'export default function ModerateActions',
    url: '`/api/admin/reviews/${reviewId}/moderate`',
    stepUp: 'none',
    status: 'protected',
  },
  {
    route: 'apps/admin-panel/src/app/api/admin/returns/[id]/review/route.ts',
    client: 'apps/admin-panel/src/app/(panel)/iadeler/_components/return-review-actions.tsx',
    clientScope: 'export function ReturnReviewActions',
    url: '`/api/admin/returns/${returnId}/review`',
    stepUp: 'none',
    status: 'protected',
  },
  {
    // The legacy button sends refundAmount=0 while the route requires a
    // positive amount. Do not add checkCsrf until a finance-safe amount entry
    // flow is separately specified; otherwise the UI becomes a guaranteed 403.
    route: 'apps/admin-panel/src/app/api/admin/returns/[id]/mark-received/route.ts',
    client: 'apps/admin-panel/src/app/(panel)/iadeler/page.tsx',
    clientScope: 'export default async function ReturnsAdminPage',
    url: '`/api/admin/returns/${r.id}/mark-received`',
    stepUp: 'none',
    status: 'unresolved',
  },
]

const STEP_UP_PROTECTED_NOT_TARGETED = [
  'apps/admin-panel/src/app/api/admin/orders/[id]/penalties/route.ts',
  'apps/admin-panel/src/app/api/admin/penalties/[id]/waive/route.ts',
  'apps/admin-panel/src/app/api/admin/payments/eft/[orderId]/approve/route.ts',
  'apps/admin-panel/src/app/api/admin/payments/eft/[orderId]/reject/route.ts',
  'apps/admin-panel/src/app/api/admin/payouts/[id]/release/route.ts',
]

async function source(relativePath: string) {
  return readFile(path.join(ROOT, relativePath), 'utf8')
}

function scopeFrom(sourceText: string, marker: string) {
  const start = sourceText.indexOf(marker)
  expect(start, `missing component scope: ${marker}`).toBeGreaterThanOrEqual(0)
  return sourceText.slice(start)
}

describe('HNJ-SEC-008 admin CSRF route/client manifest', () => {
  it('keeps every resolved step-up-less target paired with a CSRF client call', async () => {
    const resolvedTargets = HNJ_SEC_008_TARGETS.filter((target) => target.status === 'protected')
    expect(resolvedTargets).toHaveLength(4)
    expect(resolvedTargets.every((target) => target.stepUp === 'none')).toBe(true)

    for (const target of resolvedTargets) {
      const [routeSource, clientSource] = await Promise.all([
        source(target.route),
        source(target.client),
      ])
      const clientScope = scopeFrom(clientSource, target.clientScope)

      expect(routeSource).toContain("import { checkCsrf } from '@hanuja/api/lib/csrf-check'")
      expect(routeSource).toContain('const csrfError = checkCsrf(req)')
      expect(routeSource.indexOf('checkCsrf(req)')).toBeLessThan(routeSource.indexOf('getSession'))

      expect(clientScope).toContain('csrfFetch')
      expect(clientScope).toContain(target.url)
      // Catches literals, template URLs and fetch(url) alike within the
      // explicitly mapped action component.
      expect(clientScope).not.toMatch(/\bfetch\s*\(/)
    }
  })

  it('records the native mark-received form as intentionally unresolved', async () => {
    const target = HNJ_SEC_008_TARGETS.find((item) => item.status === 'unresolved')
    expect(target).toBeDefined()
    if (!target) return

    const [routeSource, clientSource] = await Promise.all([
      source(target.route),
      source(target.client),
    ])
    expect(routeSource).not.toContain('checkCsrf(req)')
    expect(scopeFrom(clientSource, target.clientScope)).toContain(target.url)
    expect(clientSource).toContain('refundAmount" value="0"')
  })

  it('documents the separate step-up-protected financial routes', async () => {
    const routes = await Promise.all(STEP_UP_PROTECTED_NOT_TARGETED.map(source))
    for (const routeSource of routes) {
      expect(routeSource).toContain('requireAdminStepUp')
    }
  })
})

describe('checkCsrf with CSRF_STRICT=true', () => {
  const originalNodeEnv = process.env['NODE_ENV']
  const originalStrict = process.env['CSRF_STRICT']

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = originalNodeEnv
    if (originalStrict === undefined) delete process.env['CSRF_STRICT']
    else process.env['CSRF_STRICT'] = originalStrict
  })

  it('rejects a mutating development request without the double-submit header', () => {
    process.env['NODE_ENV'] = 'test'
    process.env['CSRF_STRICT'] = 'true'

    const result = checkCsrf(
      new NextRequest('https://admin.example.test/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { cookie: 'hanuja-csrf=csrf-token' },
      }),
    )

    expect(result?.status).toBe(403)
  })

  it('accepts matching token values and safe methods when strict mode is enabled', () => {
    process.env['NODE_ENV'] = 'test'
    process.env['CSRF_STRICT'] = 'true'

    const protectedRequest = new NextRequest(
      'https://admin.example.test/api/admin/platform-settings',
      {
        method: 'PATCH',
        headers: {
          cookie: 'hanuja-csrf=csrf-token',
          'x-csrf-token': 'csrf-token',
        },
      },
    )
    const safeRequest = new NextRequest('https://admin.example.test/api/admin/platform-settings')

    expect(checkCsrf(protectedRequest)).toBeNull()
    expect(checkCsrf(safeRequest)).toBeNull()
  })
})
