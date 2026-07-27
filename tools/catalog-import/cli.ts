import fs from 'node:fs/promises'
import path from 'node:path'
import { discoverWorkbook, normalizeWorkbook, writeJson } from './workbook'
import { applyManifest, dryRun, verifyManifest } from './runner'
import type { ImportProfile } from './types'

function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
function requireOption(name: string) { const value = option(name); if (!value) throw new Error(`Missing ${name}.`); return value }
async function profileFrom(value?: string): Promise<ImportProfile | undefined> { return value ? JSON.parse(await fs.readFile(value, 'utf8')) as ImportProfile : undefined }
function summary(command: string, result: Record<string, unknown>) { process.stdout.write(`${command}: ${Object.entries(result).map(([key, value]) => `${key}=${typeof value === 'string' ? path.resolve(value) : value}`).join(' ')}\n`) }

async function main() {
  const command = process.argv[2]
  if (!command || ['help', '--help', '-h'].includes(command)) { process.stdout.write('Usage: pnpm catalog-import <discover|normalize|dry-run|apply|verify> ...\n'); return }
  if (command === 'discover') { const report = await discoverWorkbook(requireOption('--input'), await profileFrom(option('--profile'))); const output = option('--output') ?? '.tmp/catalog-import/mapping-report.json'; const outputPath = await writeJson(output, report); summary(command, { candidates: report.candidates.length, blocking: report.blockingErrors.length, output: outputPath }); if (report.blockingErrors.length) process.exitCode = 1; return }
  if (command === 'normalize') {
    const workbook = await normalizeWorkbook(requireOption('--input'), await profileFrom(option('--profile')))
    const outputPath = await writeJson(requireOption('--output'), workbook)
    const mappingPath = await writeJson(`${outputPath}.mapping-report.json`, workbook.mapping)
    summary(command, { rows: workbook.rows.length, blocking: workbook.mapping.blockingErrors.length, output: outputPath, mapping: mappingPath })
    if (workbook.mapping.blockingErrors.length) process.exitCode = 1
    return
  }
  if (command === 'dry-run') { const result = await dryRun({ normalizedPath: requireOption('--input'), sellerSlug: requireOption('--store'), displayName: option('--display-name') }); summary(command, { ...result.counts, manifest: result.manifestPath, audit: result.auditPath }); return }
  if (command === 'apply') { const result = await applyManifest({ manifestPath: requireOption('--manifest'), confirmStore: requireOption('--confirm-store') }); summary(command, { ...result.counts, audit: result.auditPath }); return }
  if (command === 'verify') { const result = await verifyManifest({ manifestPath: requireOption('--manifest') }); summary(command, { ...result.counts, audit: result.auditPath }); return }
  throw new Error(`Unknown command: ${command}`)
}

void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
