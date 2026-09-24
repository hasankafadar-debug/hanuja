/**
 * Resets price history trust (e-mail plan phase 6). The affected keys write their current price
 * as a `reconcile` row and wait 15 days again before any lowest-price e-mail.
 * Use after a database restore (triggers may have been bypassed) or on request.
 *
 *   pnpm price-history:reset --all --reason restore
 *   pnpm price-history:reset --product <id> [--product <id>] --reason manual
 *   pnpm price-history:reset --seller <id> --reason manual
 */
import 'dotenv/config'
import { prisma } from '../../api/lib/prisma'
import { resetPriceHistoryTrust } from '../../api/services/price-change-reconcile.service'

function readArgs(argv: string[]) {
  const productIds: string[] = []
  const sellerIds: string[] = []
  let all = false
  let reason = ''
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--all') all = true
    else if (arg === '--product') productIds.push(argv[++index] ?? '')
    else if (arg === '--seller') sellerIds.push(argv[++index] ?? '')
    else if (arg === '--reason') reason = argv[++index] ?? ''
  }
  return { productIds: productIds.filter(Boolean), sellerIds: sellerIds.filter(Boolean), all, reason: reason.trim() }
}

async function main() {
  const args = readArgs(process.argv.slice(2))
  if (!args.reason || !/^[a-z0-9_-]{3,60}$/.test(args.reason)) {
    throw new Error('--reason is required (3-60 chars: a-z, 0-9, _ or -)')
  }
  if (!args.all && !args.productIds.length && !args.sellerIds.length) {
    throw new Error('Choose --all, --product <id> or --seller <id>')
  }
  const count = await resetPriceHistoryTrust(
    prisma,
    { all: args.all, productIds: args.productIds, sellerIds: args.sellerIds },
    `manual:${args.reason}`,
  )
  console.log('products_reset', count)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'PRICE_HISTORY_RESET_FAILED')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
