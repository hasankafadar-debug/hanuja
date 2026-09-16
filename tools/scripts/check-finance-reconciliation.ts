import prisma from '../../api/lib/prisma'
import { reconcileFinance } from '../../api/services/finance-reconciliation.service'

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args[0] && !/^--seller-id=.+$/.test(args[0]))) {
    throw new Error('Usage: pnpm finance:reconcile [--seller-id=ID]')
  }
  const result = await reconcileFinance(prisma, args[0]?.slice('--seller-id='.length))
  console.log(JSON.stringify(result, null, 2))
  if (result.findings.length) process.exitCode = 1
}
main()
  .catch(() => {
    console.error('Finance reconciliation failed; no complete report was produced.')
    process.exitCode = 2
  })
  .finally(() => prisma.$disconnect())
