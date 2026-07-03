import type { Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type AuditPriority = 'P1' | 'P2' | 'P3' | 'P4'

export interface AuditFindingInput {
  priority: AuditPriority
  url: string
  clickedControl: string
  steps: string[]
  expected: string
  actual: string
  fixtureUsed: string
  screenshot?: string
  consoleNetwork?: string[]
}

export interface HistoricalFinding {
  title: string
  status: 'historical / closed by migration'
  details: string
}

interface AuditFinding extends AuditFindingInput {
  consoleNetwork: string[]
}

interface AuditSuccess {
  control: string
  url: string
  fixtureUsed: string
}

export function attachPageDiagnostics(page: Page) {
  const consoleEntries: string[] = []
  const networkEntries: string[] = []

  page.on('console', (message) => {
    const type = message.type()
    if (type === 'error' || type === 'warning') {
      consoleEntries.push(`[console:${type}] ${message.text()}`)
    }
  })

  page.on('pageerror', (error) => {
    consoleEntries.push(`[pageerror] ${error.message}`)
  })

  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText ?? 'unknown failure'
    networkEntries.push(`[requestfailed] ${request.method()} ${request.url()} -> ${failureText}`)
  })

  page.on('response', (response) => {
    if (response.status() >= 400) {
      networkEntries.push(
        `[response:${response.status()}] ${response.request().method()} ${response.url()}`,
      )
    }
  })

  return {
    mark() {
      return {
        consoleIndex: consoleEntries.length,
        networkIndex: networkEntries.length,
      }
    },
    slice(mark: { consoleIndex: number; networkIndex: number }) {
      return [
        ...consoleEntries.slice(mark.consoleIndex),
        ...networkEntries.slice(mark.networkIndex),
      ]
    },
  }
}

export class CustomerAuditRecorder {
  private findings: AuditFinding[] = []
  private successes: AuditSuccess[] = []

  constructor(
    private readonly reportPath: string,
    private readonly screenshotDir: string,
    private readonly historicalFindings: HistoricalFinding[],
  ) {}

  recordSuccess(control: string, url: string, fixtureUsed: string) {
    this.successes.push({ control, url, fixtureUsed })
  }

  recordFinding(input: AuditFindingInput) {
    this.findings.push({
      ...input,
      consoleNetwork: input.consoleNetwork ?? [],
    })
  }

  async captureFailure(
    page: Page,
    input: Omit<AuditFindingInput, 'actual' | 'screenshot' | 'consoleNetwork'> & {
      actual?: string
    },
    diagnostics: string[],
    error: unknown,
  ) {
    const fileName = `${String(this.findings.length + 1).padStart(2, '0')}-${slugify(input.clickedControl)}.png`
    const screenshotPath = path.join(this.screenshotDir, fileName)
    await fs.mkdir(this.screenshotDir, { recursive: true })
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)

    const actual =
      input.actual ??
      (error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error')

    this.recordFinding({
      ...input,
      actual,
      screenshot: screenshotPath,
      consoleNetwork: diagnostics,
    })
  }

  async writeReport() {
    await fs.mkdir(path.dirname(this.reportPath), { recursive: true })
    const lines: string[] = []

    lines.push('# Customer Role Post-Migration Audit')
    lines.push('')
    lines.push(`- generated_at: ${new Date().toISOString()}`)
    lines.push(`- successful_controls: ${this.successes.length}`)
    lines.push(`- open_findings: ${this.findings.length}`)
    lines.push('')

    lines.push('## Open Findings')
    lines.push('')
    if (this.findings.length === 0) {
      lines.push('No current post-migration findings were recorded.')
      lines.push('')
    } else {
      for (const [index, finding] of this.findings.entries()) {
        lines.push(`### ${index + 1}. ${finding.priority} - ${finding.clickedControl}`)
        lines.push(`- priority: ${finding.priority}`)
        lines.push(`- url: ${finding.url}`)
        lines.push(`- clicked_control: ${finding.clickedControl}`)
        lines.push(`- steps: ${finding.steps.join(' -> ')}`)
        lines.push(`- expected: ${finding.expected}`)
        lines.push(`- actual: ${finding.actual}`)
        lines.push(
          `- console/network: ${finding.consoleNetwork.length > 0 ? finding.consoleNetwork.join(' | ') : 'none'}`,
        )
        lines.push(`- screenshot: ${finding.screenshot ?? 'none'}`)
        lines.push(`- fixture_used: ${finding.fixtureUsed}`)
        lines.push('')
      }
    }

    lines.push('## Historical / Closed By Migration')
    lines.push('')
    for (const finding of this.historicalFindings) {
      lines.push(`- ${finding.title}: ${finding.status}. ${finding.details}`)
    }
    lines.push('')

    lines.push('## Successful Controls')
    lines.push('')
    if (this.successes.length === 0) {
      lines.push('No successful controls were recorded.')
      lines.push('')
    } else {
      for (const success of this.successes) {
        lines.push(`- ${success.control} @ ${success.url} [fixture: ${success.fixtureUsed}]`)
      }
      lines.push('')
    }

    await fs.writeFile(this.reportPath, `${lines.join('\n')}\n`, 'utf8')
  }

  getPrioritySummary() {
    return this.findings.reduce<Record<AuditPriority, number>>(
      (acc, finding) => {
        acc[finding.priority] += 1
        return acc
      },
      { P1: 0, P2: 0, P3: 0, P4: 0 },
    )
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
