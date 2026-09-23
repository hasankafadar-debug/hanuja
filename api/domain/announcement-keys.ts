/**
 * Server-only announcement keys (e-mail plan phase 5): the hash that binds a previewed
 * list to a send, and the per-recipient notification event key.
 */
import { createHash } from 'node:crypto'

/** Binds a previewed list to a send: the same ids in any order give the same hash. */
export function hashAudience(sellerIds: readonly string[]): string {
  return createHash('sha256')
    .update([...new Set(sellerIds)].sort().join('\n'))
    .digest('hex')
}

export function announcementEventKey(announcementId: string, sellerId: string): string {
  return `announcement:${announcementId}:seller:${sellerId}`
}
