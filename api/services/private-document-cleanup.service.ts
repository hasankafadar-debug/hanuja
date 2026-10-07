import { Prisma, type PrismaClient } from '@prisma/client'
import { deleteObject } from '../lib/r2'
import {
  deletePrivateDocumentFile,
  isPrivateDocumentStorageKey,
} from '../lib/private-document-storage'

const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000
const ALERT_ATTEMPTS = 8

export interface PrivateDocumentCleanupOptions {
  prisma?: PrismaClient
  fileKey?: string
  deleteFile?: (fileKey: string) => Promise<void>
  now?: Date
}

export interface PrivateDocumentCleanupResult {
  processed: number
  completed: number
  retried: number
  deferred: number
}

function assertInvoiceFileKey(fileKey: string): void {
  if (isPrivateDocumentStorageKey(fileKey)) return
  // Old invoices were stored in R2's documents folder. Never route an invalid
  // private key to R2 or allow a cleanup intent to target another media folder.
  if (
    !/^documents\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(fileKey) ||
    fileKey.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Invalid invoice document storage key.')
  }
}

/** Must be called inside the transaction that drops the active file reference. */
export async function schedulePrivateDocumentCleanup(
  tx: Pick<Prisma.TransactionClient, 'privateDocumentCleanup'>,
  fileKey: string,
): Promise<void> {
  assertInvoiceFileKey(fileKey)
  await tx.privateDocumentCleanup.upsert({
    where: { fileKey },
    create: { fileKey },
    // A duplicate removal/replacement does not reset the retry schedule or resurrect
    // an already completed deletion. Stored file keys are never reused.
    update: {},
  })
}

export async function deleteInvoiceDocumentFile(fileKey: string): Promise<void> {
  assertInvoiceFileKey(fileKey)
  if (isPrivateDocumentStorageKey(fileKey)) {
    await deletePrivateDocumentFile(fileKey)
    return
  }
  await deleteObject(fileKey)
}

/** Process one intent immediately, or a bounded due sweep from the five-minute worker. */
export async function processPrivateDocumentCleanup(
  options: PrivateDocumentCleanupOptions = {},
): Promise<PrivateDocumentCleanupResult> {
  const db = options.prisma ?? (await import('../lib/prisma')).prisma
  const now = options.now ?? new Date()
  const deleteFile = options.deleteFile ?? deleteInvoiceDocumentFile
  const result: PrivateDocumentCleanupResult = {
    processed: 0,
    completed: 0,
    retried: 0,
    deferred: 0,
  }
  const pending = await db.privateDocumentCleanup.findMany({
    where: {
      status: 'pending',
      ...(options.fileKey ? { fileKey: options.fileKey } : { nextAttemptAt: { lte: now } }),
    },
    select: { fileKey: true },
    orderBy: { nextAttemptAt: 'asc' },
    take: options.fileKey ? 1 : 100,
  })

  for (const item of pending) {
    const outcome = await db.$transaction(async (tx) => {
      // API post-commit cleanup and the worker can meet on the same intent.
      // Keep the lock until the deletion outcome is committed; deleting twice is safe,
      // but a late failed runner must never turn completed back into pending.
      const locks = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`private-document-cleanup:${item.fileKey}`}, 0)) AS locked
      `)
      if (!locks[0]?.locked) return 'deferred' as const

      const intent = await tx.privateDocumentCleanup.findUnique({ where: { fileKey: item.fileKey } })
      if (!intent || intent.status !== 'pending') return null
      if (!options.fileKey && intent.nextAttemptAt > now) return null

      const activeInvoice = await tx.orderSellerInvoice.findFirst({
        where: { fileKey: item.fileKey },
        select: { id: true },
      })
      if (activeInvoice) {
        await tx.privateDocumentCleanup.update({
          where: { id: intent.id },
          data: {
            nextAttemptAt: new Date(now.getTime() + SWEEP_INTERVAL_MS),
            lastError: 'File is still referenced by an active invoice.',
          },
        })
        return 'deferred' as const
      }

      try {
        // Validate even with an injected deletion function, including malformed old
        // rows created before validation existed.
        assertInvoiceFileKey(item.fileKey)
        await deleteFile(item.fileKey)
      } catch (error) {
        const attempts = intent.attempts + 1
        const delayMs = Math.min(
          MAX_RETRY_DELAY_MS,
          SWEEP_INTERVAL_MS * 2 ** Math.min(attempts - 1, 10),
        )
        const lastError = error instanceof Error ? error.message.slice(0, 1000) : 'File deletion failed.'
        await tx.privateDocumentCleanup.update({
          where: { id: intent.id },
          data: {
            attempts,
            lastError,
            nextAttemptAt: new Date(now.getTime() + delayMs),
          },
        })
        if (attempts >= ALERT_ATTEMPTS) {
          console.error('[private-document-cleanup][operational-alert]', {
            cleanupId: intent.id,
            attempts,
            error: lastError,
          })
        }
        return 'retried' as const
      }

      await tx.privateDocumentCleanup.update({
        where: { id: intent.id },
        data: {
          status: 'completed',
          attempts: intent.attempts + 1,
          lastError: null,
          completedAt: now,
        },
      })
      return 'completed' as const
    }, { maxWait: 5000, timeout: 30000 })

    if (outcome) {
      result.processed += 1
      result[outcome] += 1
    }
  }
  return result
}
