/**
 * The seller dashboard shows a "Ürün Soruları" card with the same count as the
 * menu badge, tinted yellow while at least one conversation is unread.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const DASHBOARD_PAGE = fileURLToPath(
  new URL('../../apps/seller-panel/src/app/(panel)/dashboard/page.tsx', import.meta.url),
)
const STAT_CARD = fileURLToPath(new URL('../../packages/ui/src/components/composite/stat-card.tsx', import.meta.url))

describe('seller dashboard product questions card', () => {
  it('links to the conversations and turns yellow from one unread conversation', async () => {
    const source = await readFile(DASHBOARD_PAGE, 'utf8')
    const start = source.indexOf('title="Ürün Soruları"')
    expect(start).toBeGreaterThan(-1)
    const card = source.slice(source.lastIndexOf('<Link', start), source.indexOf('</Link>', start))
    expect(card).toContain('href="/musteri-sorulari"')
    expect(card).toContain('value={unreadQuestions}')
    expect(card).toContain("tone={unreadQuestions > 0 ? 'warning' : 'default'}")
    expect(source).toContain('countUnreadForSeller(seller.id)')
  })

  it('renders the warning tone yellow with an accessible signal', async () => {
    const source = await readFile(STAT_CARD, 'utf8')
    expect(source).toContain('border-[#fde047] bg-[#fefce8]')
    expect(source).toContain('bg-[#fef9c3] text-[#a16207]')
    expect(source).toContain('{needsAction && <span className="sr-only">İşlem bekliyor</span>}')
  })
})
