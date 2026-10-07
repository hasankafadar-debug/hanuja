import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  deleteInvoiceDocumentFile,
  processPrivateDocumentCleanup,
  schedulePrivateDocumentCleanup,
} from '../../api/services/private-document-cleanup.service'

vi.mock('../../api/lib/r2', () => ({ deleteObject: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../api/lib/private-document-storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/lib/private-document-storage')>(),
  deletePrivateDocumentFile: vi.fn().mockResolvedValue(undefined),
}))

const KEY = 'private/v1/ab/ab000000-0000-0000-0000-000000000000.bin'
const NOW = new Date('2026-10-07T12:00:00.000Z')

type Intent = {
  id: string
  fileKey: string
  status: 'pending' | 'completed'
  attempts: number
  nextAttemptAt: Date
  lastError: string | null
  completedAt: Date | null
}

function fixture(overrides: Partial<Intent> = {}) {
  const row: Intent = {
    id: 'cleanup-1', fileKey: KEY, status: 'pending', attempts: 0,
    nextAttemptAt: NOW, lastError: null, completedAt: null, ...overrides,
  }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
    privateDocumentCleanup: {
      findUnique: vi.fn().mockImplementation(async () => ({ ...row })),
      update: vi.fn().mockImplementation(async ({ data }) => Object.assign(row, data)),
      upsert: vi.fn().mockResolvedValue(row),
    },
    orderSellerInvoice: { findFirst: vi.fn().mockResolvedValue(null) },
  }
  const db = {
    privateDocumentCleanup: {
      findMany: vi.fn().mockImplementation(async ({ where }) =>
        row.status === where.status && (!where.nextAttemptAt || row.nextAttemptAt <= where.nextAttemptAt.lte)
          ? [{ fileKey: row.fileKey }] : []),
    },
    $transaction: vi.fn().mockImplementation(async (fn) => fn(tx)),
  }
  const deleteFile = vi.fn().mockResolvedValue(undefined)
  const run = (now = NOW) => processPrivateDocumentCleanup({
    prisma: db as unknown as PrismaClient, deleteFile, now,
  })
  return { row, tx, db, deleteFile, run }
}

afterEach(() => vi.restoreAllMocks())

describe('durable private document cleanup', () => {
  it('schedules idempotently inside the caller transaction without resetting completed intents', async () => {
    const { tx } = fixture({ status: 'completed', attempts: 2 })
    await schedulePrivateDocumentCleanup(tx as never, KEY)
    expect(tx.privateDocumentCleanup.upsert).toHaveBeenCalledWith({
      where: { fileKey: KEY }, create: { fileKey: KEY }, update: {},
    })
    await expect(schedulePrivateDocumentCleanup(tx as never, 'private/v1/../outside'))
      .rejects.toThrow('Invalid invoice document storage key.')
  })

  it('deletes once and marks completion; another sweep does not delete or count it again', async () => {
    const f = fixture()
    expect(await f.run()).toEqual({ processed: 1, completed: 1, retried: 0, deferred: 0 })
    expect(f.row.status).toBe('completed')
    expect(f.row.completedAt).toEqual(NOW)
    expect(await f.run()).toEqual({ processed: 0, completed: 0, retried: 0, deferred: 0 })
    expect(f.deleteFile).toHaveBeenCalledOnce()
  })

  it('retains a failed deletion and retries when due, including crash-after-delete recovery', async () => {
    const f = fixture()
    f.deleteFile.mockRejectedValueOnce(new Error('Volume unavailable'))
    expect((await f.run()).retried).toBe(1)
    expect(f.row).toMatchObject({ status: 'pending', attempts: 1, lastError: 'Volume unavailable' })
    expect(f.row.nextAttemptAt).toEqual(new Date(NOW.getTime() + 5 * 60_000))
    expect((await f.run()).processed).toBe(0)
    // The deletion function is idempotent even when a previous process already removed bytes.
    expect((await f.run(f.row.nextAttemptAt)).completed).toBe(1)
    expect(f.row.lastError).toBeNull()
  })

  it('defers keys that are still referenced by an active invoice without deleting them', async () => {
    const f = fixture()
    f.tx.orderSellerInvoice.findFirst.mockResolvedValue({ id: 'active-invoice' })
    expect((await f.run()).deferred).toBe(1)
    expect(f.deleteFile).not.toHaveBeenCalled()
    expect(f.row.attempts).toBe(0)
    expect(f.row.status).toBe('pending')
    expect(f.row.nextAttemptAt).toEqual(new Date(NOW.getTime() + 5 * 60_000))
  })

  it('defers a concurrent runner when another process holds the file cleanup lock', async () => {
    const f = fixture()
    f.tx.$queryRaw.mockResolvedValue([{ locked: false }])
    expect((await f.run()).deferred).toBe(1)
    expect(f.deleteFile).not.toHaveBeenCalled()
    expect(f.tx.privateDocumentCleanup.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid persisted file key before the deletion callback', async () => {
    const f = fixture({ fileKey: '../../outside' })
    expect((await f.run()).retried).toBe(1)
    expect(f.deleteFile).not.toHaveBeenCalled()
    expect(f.row.lastError).toBe('Invalid invoice document storage key.')
  })

  it('caps retries at one hour and emits an operational alert after repeated failures', async () => {
    const f = fixture({ attempts: 7 })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    f.deleteFile.mockRejectedValue(new Error('Permission denied'))
    await f.run()
    expect(f.row.attempts).toBe(8)
    expect(f.row.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60 * 60_000))
    expect(log).toHaveBeenCalledWith('[private-document-cleanup][operational-alert]', {
      cleanupId: 'cleanup-1', attempts: 8, error: 'Permission denied',
    })
  })

  it('routes canonical legacy document keys to R2 and rejects other media keys', async () => {
    const { deleteObject } = await import('../../api/lib/r2')
    const { deletePrivateDocumentFile } = await import('../../api/lib/private-document-storage')
    await deleteInvoiceDocumentFile('documents/order1/invoice.pdf')
    expect(deleteObject).toHaveBeenCalledWith('documents/order1/invoice.pdf')
    await deleteInvoiceDocumentFile(KEY)
    expect(deletePrivateDocumentFile).toHaveBeenCalledWith(KEY)
    await expect(deleteInvoiceDocumentFile('products/order1/photo.jpg')).rejects.toThrow()
    await expect(deleteInvoiceDocumentFile('documents/order1/../invoice.pdf')).rejects.toThrow()
  })
})
