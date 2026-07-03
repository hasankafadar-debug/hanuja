#!/usr/bin/env tsx
/**
 * Pre-deploy Duplicate providerPaymentId Guard
 *
 * Migration `20260703100000_payment_provider_payment_id_unique` adds a UNIQUE
 * constraint on `payments.providerPaymentId`. Before that migration runs against
 * a data-bearing (staging/production) database, any existing duplicate
 * providerPaymentId rows must be manually reconciled — otherwise the migration
 * fails outright (or worse, if it somehow succeeded, would mean an Iyzico
 * paymentId had confirmed more than one order — a replay/finance-integrity bug).
 *
 * This script is NOT part of `pnpm release-check`. `release-check` runs against
 * dev/CI databases as part of the normal build/test gate. This script is a
 * PRODUCTION-ONLY pre-migration guard: it must be run manually (or as an explicit
 * deploy-pipeline step) against the real production DATABASE_URL, immediately
 * before `pnpm db:migrate:deploy`, and only as part of that specific migration's
 * rollout. See docs/07-operations/production-deploy-runbook.md step 4.
 *
 * Usage:
 *   pnpm check-duplicate-payments      # run against DATABASE_URL
 *
 * Exit codes:
 *   0 — no duplicates found, migration can proceed
 *   1 — duplicates found (blocking) OR could not verify (fail-closed)
 */

import { config as loadDotEnv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../')

// Load .env from repo root if it exists
loadDotEnv({ path: path.join(repoRoot, '.env') })

interface DuplicateGroupRow {
  providerPaymentId: string
  count: bigint
}

interface DuplicateMemberRow {
  id: string
  orderId: string
  providerPaymentId: string
  status: string
  createdAt: Date
}

async function main() {
  console.log(`\nHanuja Duplicate providerPaymentId Guard`)
  console.log(`${'─'.repeat(40)}`)

  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    console.error('FAIL  DATABASE_URL tanımlı değil.')
    console.error('      Bu script yalnızca canlı (veya hedef) veritabanına karşı,')
    console.error('      migrate deploy öncesi elle çalıştırılmalıdır.')
    console.error('      "bilmiyorum" durumunda güvenli varsayılan REDDETMEKTİR (fail-closed).\n')
    process.exit(1)
  }

  const prisma = new PrismaClient()

  try {
    await prisma.$connect()

    const duplicateGroups = await prisma.$queryRaw<DuplicateGroupRow[]>`
      SELECT "providerPaymentId", count(*) as count
      FROM payments
      WHERE "providerPaymentId" IS NOT NULL
      GROUP BY 1
      HAVING count(*) > 1
    `

    if (duplicateGroups.length === 0) {
      console.log('OK — duplicate providerPaymentId bulunamadı, migration güvenle çalıştırılabilir.\n')
      process.exit(0)
    }

    console.error(`FAIL  ${duplicateGroups.length} adet tekrarlanan providerPaymentId bulundu:\n`)

    for (const group of duplicateGroups) {
      console.error(`  !  providerPaymentId=${group.providerPaymentId}  (${group.count.toString()} kayıt)`)

      try {
        const members = await prisma.$queryRaw<DuplicateMemberRow[]>`
          SELECT id, "orderId", "providerPaymentId", status, "createdAt"
          FROM payments
          WHERE "providerPaymentId" = ${group.providerPaymentId}
          ORDER BY "createdAt" ASC
        `
        for (const m of members) {
          console.error(
            `       - payment.id=${m.id}  orderId=${m.orderId}  status=${m.status}  createdAt=${m.createdAt.toISOString()}`,
          )
        }
      } catch (detailError) {
        console.error(`       (ilişkili kayıt detayları alınamadı: ${String(detailError)})`)
      }
    }

    console.error(
      '\nMigration\'ı (20260703100000_payment_provider_payment_id_unique) çalıştırmadan önce',
    )
    console.error('bu kayıtları elle mutabakat yapın: hangi payment gerçek onaylanmış ödemeyi temsil')
    console.error('ediyor, hangi kayıt hatalı/tekrar mı belirleyin ve gerekirse düzeltici veri')
    console.error('değişikliği + finans mutabakatı yapın. Detaylar: docs/07-operations/production-deploy-runbook.md\n')

    process.exit(1)
  } catch (error) {
    console.error('FAIL  Veritabanına bağlanılamadı veya sorgu başarısız oldu.')
    console.error(`      ${String(error)}`)
    console.error('      "bilmiyorum" durumunda güvenli varsayılan REDDETMEKTİR (fail-closed).\n')
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
