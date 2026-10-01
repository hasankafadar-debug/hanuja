// Offline evidence collection. No environment files, network calls or raw secrets.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../../..')
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter(path => !/(^|\/)(node_modules|outputs|\.next|\.claude)(\/|$)/.test(path))
  .filter(path => !/(^|\/)\.env(?:\.|$)/.test(path))

const patterns = {
  rawSql: /\$(?:queryRawUnsafe|executeRawUnsafe)\b/,
  htmlSink: /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML\(/,
  dynamicExecution: /\beval\(|new Function\(|shell:\s*true/,
  outgoingRequest: /\bfetch\(|https?\.request\(|https?\.get\(/,
  privateKey: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  credentialLiteral: /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk_live_[A-Za-z0-9]{20,})/,
}

const routes = []
const candidates = []
const manifests = []
for (const path of files) {
  if (!/\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|sh|md)$/.test(path) && !/Dockerfile/.test(path)) continue
  const content = readFileSync(resolve(root, path), 'utf8')
  if (/^apps\/[^/]+\/src\/app\/api\/.*\/route\.ts$/.test(path)) {
    const methods = [...content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(match => match[1])
    routes.push({ path, methods, sha256: createHash('sha256').update(content).digest('hex'),
      authReference: /getSession|require\w*(?:Admin|Seller|Session)|getSessionUser|getSellerSession/.test(content),
      csrfReference: /checkCsrf|checkPanelOrigin|verifyTurnstileAuthRequest|\.handler\(/.test(content),
      mutating: methods.some(method => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) })
  }
  if (path.endsWith('package.json')) {
    const manifest = JSON.parse(content)
    manifests.push({ path, name: manifest.name, dependencies: manifest.dependencies ?? {}, overrides: manifest.pnpm?.overrides ?? {} })
  }
  if (!/^(apps|api|packages|tools)\//.test(path)) continue
  for (const [kind, pattern] of Object.entries(patterns)) {
    content.split(/\r?\n/).forEach((line, index) => {
      if (pattern.test(line)) candidates.push({ kind, path, line: index + 1 })
    })
  }
}
const result = {
  recordedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  mode: 'offline; candidate matches are not confirmed vulnerabilities',
  sourceState: 'working-tree contents; commit identifies the local base, not a deployment',
  limitations: ['No registry advisory query', 'No production configuration access', 'No environment files read', 'No live customer data', 'Narrow credential patterns only; Git history not scanned'],
  routes, candidates, manifests,
}
mkdirSync(resolve(directory, 'kanitlar'), { recursive: true })
writeFileSync(resolve(directory, 'kanitlar/inventory.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ routes: routes.length, mutatingRoutes: routes.filter(route => route.mutating).length,
  mutationsWithoutDirectCsrfReference: routes.filter(route => route.mutating && !route.csrfReference).length,
  candidateCounts: Object.fromEntries(Object.keys(patterns).map(kind => [kind, candidates.filter(item => item.kind === kind).length])),
  output: 'tests/security/audit-2026-10-01/kanitlar/inventory.json' }, null, 2))
