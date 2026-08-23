#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client'
import 'dotenv/config'
import { optimizeHomeMediaAssets } from '../../api/services/home-media-optimizer.service'

function parseApplyFlag(args: string[]) {
  const allowed = new Set(['--apply', '--dry-run'])
  const unknown = args.filter((arg) => !allowed.has(arg))
  if (unknown.length > 0) throw new Error(`Bilinmeyen arguman: ${unknown.join(', ')}`)
  if (args.includes('--apply') && args.includes('--dry-run')) {
    throw new Error('--apply ve --dry-run birlikte kullanilamaz.')
  }
  return args.includes('--apply')
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2))
  const publicBaseUrl = process.env.R2_PUBLIC_URL?.trim()
  if (!publicBaseUrl) throw new Error('R2_PUBLIC_URL tanimli degil.')

  const prisma = new PrismaClient()
  try {
    const summary = await optimizeHomeMediaAssets({
      prisma,
      apply,
      publicBaseUrl,
      onProgress: (message) => console.log(message),
    })

    console.log(JSON.stringify(summary, null, 2))
    if (summary.failed.length > 0) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
