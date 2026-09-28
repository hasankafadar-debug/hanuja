/**
 * Guard for patches/next@15.5.22.patch — backport of the React fix
 * facebook/react c0d218f0f3 (#36134, "Fix useDeferredValue getting stuck").
 *
 * The React 19.2 canary bundled in next@15.5.22 drops a ping that arrives during
 * render while the root has exited RootSuspendedWithDelay. React Flight defers any
 * element past 3200 serialized bytes into a lazy row; when such a row lands while
 * React yields, the later ping listener resolves it synchronously and the ping is
 * lost. The transition then never commits: client navigation to /siparis hung
 * until a second click (see .claude/rules/12-production-readiness.md §40).
 *
 * Remove the patch and this test when Next ships React with that commit
 * (Next >= 16.3.6). The exact-version check below fails first on any Next upgrade.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PATCHED_NEXT_VERSION = '15.5.22'
const APPS = ['web', 'seller-panel', 'admin-panel'] as const

const PRODUCTION_BUILDS = ['react-dom-client.production.js', 'react-dom-profiling.profiling.js']
const DEVELOPMENT_BUILDS = ['react-dom-client.development.js', 'react-dom-profiling.development.js']

const PRODUCTION_FIXED =
  /0 === \(executionContext & 2\)\s*\?\s*prepareFreshStack\(root, 0\)\s*:\s*\(workInProgressRootPingedLanes \|= pingedLanes\)/
const PRODUCTION_BUGGY = /0 === \(executionContext & 2\) && prepareFreshStack\(root, 0\)/
const DEVELOPMENT_FIXED =
  /\(executionContext & RenderContext\) === NoContext\s*\?\s*prepareFreshStack\(root, 0\)\s*:\s*\(workInProgressRootPingedLanes \|= pingedLanes\)/
const DEVELOPMENT_BUGGY = /\(executionContext & RenderContext\) === NoContext &&\s*prepareFreshStack\(root, 0\)/

function resolveNext(app: (typeof APPS)[number]) {
  const appPackageJson = fileURLToPath(new URL(`../../apps/${app}/package.json`, import.meta.url))
  const nextPackageJson = createRequire(appPackageJson).resolve('next/package.json')
  return dirname(nextPackageJson)
}

async function reactDomBuild(nextDir: string, file: string) {
  return readFile(join(nextDir, 'dist/compiled/react-dom/cjs', file), 'utf8')
}

describe.each(APPS)('%s: next bundled react-dom ping backport', (app) => {
  it(`runs on next@${PATCHED_NEXT_VERSION}, the version the patch targets`, async () => {
    const nextDir = resolveNext(app)
    const { version } = JSON.parse(await readFile(join(nextDir, 'package.json'), 'utf8')) as {
      version: string
    }

    expect(version).toBe(PATCHED_NEXT_VERSION)
  })

  it.each(PRODUCTION_BUILDS)('%s records a render-phase ping instead of dropping it', async (file) => {
    const source = await reactDomBuild(resolveNext(app), file)

    expect(source).toMatch(PRODUCTION_FIXED)
    expect(source).not.toMatch(PRODUCTION_BUGGY)
  })

  it.each(DEVELOPMENT_BUILDS)('%s records a render-phase ping instead of dropping it', async (file) => {
    const source = await reactDomBuild(resolveNext(app), file)

    expect(source).toMatch(DEVELOPMENT_FIXED)
    expect(source).not.toMatch(DEVELOPMENT_BUGGY)
  })
})
