import prisma from '../../api/lib/prisma'

// Turkish UTF-8 bytes were misread as Windows-1252 (CP1252) and re-encoded as UTF-8.
// The leading byte lands in 0xC2-0xC5 (Â, Ã, Ä, Å). The continuation byte (0x80-0xBF)
// may have been mapped through CP1252's 0x80-0x9F table, where 0x9F → U+0178 (Ÿ),
// 0x9E → U+017E (ž), etc.  We need to reverse that mapping to get back the raw bytes.
//
// Affected Turkish chars via CP1252 continuation:
//   ğ U+011F → [0xC4, 0x9F] → Ä + Ÿ (U+0178)
//   ş U+015F → [0xC5, 0x9F] → Å + Ÿ (U+0178)
//   Ğ U+011E → [0xC4, 0x9E] → Ä + ž (U+017E)
//   Ş U+015E → [0xC5, 0x9E] → Å + ž (U+017E)

// CP1252 byte values for characters in the 0x80-0x9F special range
const CP1252: Map<number, number> = new Map([
  [0x20AC, 0x80], // €
  [0x201A, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201E, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02C6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8A], // Š
  [0x2039, 0x8B], // ‹
  [0x0152, 0x8C], // Œ
  [0x017D, 0x8E], // Ž
  [0x2018, 0x91], // '
  [0x2019, 0x92], // '
  [0x201C, 0x93], // "
  [0x201D, 0x94], // "
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02DC, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9A], // š
  [0x203A, 0x9B], // ›
  [0x0153, 0x9C], // œ
  [0x017E, 0x9E], // ž  ← Ş / Ğ continuation
  [0x0178, 0x9F], // Ÿ  ← ş / ğ continuation
])

function cp1252Byte(codePoint: number): number | null {
  if (codePoint <= 0xFF) return codePoint   // Latin-1 range: code point == byte
  return CP1252.get(codePoint) ?? null       // CP1252 special char → byte
}

function repair(value: string | null | undefined): string | null | undefined {
  if (value == null) return value
  if (!/[\xC2-\xC5]/.test(value)) return value

  let result = ''
  let changed = false
  let i = 0
  while (i < value.length) {
    const cp = value.charCodeAt(i)
    if (cp >= 0xC2 && cp <= 0xC5 && i + 1 < value.length) {
      const nextCp = value.charCodeAt(i + 1)
      const nextByte = cp1252Byte(nextCp)
      if (nextByte !== null && nextByte >= 0x80 && nextByte <= 0xBF) {
        // Mojibake pair: re-decode as UTF-8 bytes
        result += Buffer.from([cp, nextByte]).toString('utf8')
        i += 2
        changed = true
        continue
      }
    }
    result += value[i]
    i++
  }
  return changed ? result : value
}

type Stats = { scanned: number; rewritten: number }

async function repairLedger(dry: boolean): Promise<Stats> {
  const stats: Stats = { scanned: 0, rewritten: 0 }
  const rows = await prisma.sellerLedgerEntry.findMany({
    where: {
      OR: [
        { description: { contains: 'Ã' } },
        { description: { contains: 'Ä' } },
        { description: { contains: 'Å' } },
      ],
    },
    select: { id: true, description: true },
  })
  for (const row of rows) {
    stats.scanned++
    const fixed = repair(row.description)
    if (fixed !== row.description && typeof fixed === 'string') {
      console.log(`[ledger ${row.id}]\n  before: ${row.description}\n  after:  ${fixed}`)
      if (!dry) {
        await prisma.sellerLedgerEntry.update({
          where: { id: row.id },
          data: { description: fixed },
        })
      }
      stats.rewritten++
    }
  }
  return stats
}

async function repairOrderHistory(dry: boolean): Promise<Stats> {
  const stats: Stats = { scanned: 0, rewritten: 0 }
  const rows = await prisma.orderStatusHistory.findMany({
    where: {
      OR: [
        { note: { contains: 'Ã' } },
        { note: { contains: 'Ä' } },
        { note: { contains: 'Å' } },
        { reason: { contains: 'Ã' } },
        { reason: { contains: 'Ä' } },
        { reason: { contains: 'Å' } },
      ],
    },
    select: { id: true, note: true, reason: true },
  })
  for (const row of rows) {
    stats.scanned++
    const fixedNote = repair(row.note)
    const fixedReason = repair(row.reason)
    const noteChanged = fixedNote !== row.note
    const reasonChanged = fixedReason !== row.reason
    if (noteChanged || reasonChanged) {
      if (noteChanged) console.log(`[orderStatusHistory ${row.id}] note:\n  before: ${row.note}\n  after:  ${fixedNote}`)
      if (reasonChanged) console.log(`[orderStatusHistory ${row.id}] reason:\n  before: ${row.reason}\n  after:  ${fixedReason}`)
      if (!dry) {
        await prisma.orderStatusHistory.update({
          where: { id: row.id },
          data: {
            ...(noteChanged ? { note: fixedNote ?? null } : {}),
            ...(reasonChanged ? { reason: fixedReason ?? null } : {}),
          },
        })
      }
      stats.rewritten++
    }
  }
  return stats
}

async function main() {
  const dry = process.argv.includes('--dry')
  console.log(`Mojibake backfill running (${dry ? 'dry run — no writes' : 'live'})`)

  const ledger = await repairLedger(dry)
  console.log(`seller_ledger_entries: scanned=${ledger.scanned} rewritten=${ledger.rewritten}`)

  const orderHistory = await repairOrderHistory(dry)
  console.log(`order_status_history: scanned=${orderHistory.scanned} rewritten=${orderHistory.rewritten}`)

  console.log(dry ? 'Dry run complete. Re-run without --dry to apply.' : 'Backfill complete.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
