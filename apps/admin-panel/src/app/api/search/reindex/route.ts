import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { UnauthorizedError, ForbiddenError } from '@hanuja/api/lib/errors'
import { handleError, ok } from '@hanuja/api/lib/response'
import { configureProductsIndex } from '@hanuja/api/lib/meilisearch'
import { searchIndexSyncQueue } from '@hanuja/api/lib/queue'

/**
 * POST /api/search/reindex
 * Admin-only: trigger a full products re-index to Meilisearch.
 * Configures index settings first, then enqueues a full-sync job.
 */
export async function POST() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()

    // Ensure index is correctly configured
    await configureProductsIndex()

    // Enqueue full product re-index
    await searchIndexSyncQueue.add(
      'full-reindex',
      { type: 'product', operation: 'upsert' },
      { jobId: 'full-product-reindex', removeOnComplete: true },
    )

    return ok({ message: 'Yeniden indeksleme başlatıldı' })
  } catch (err) {
    return handleError(err)
  }
}
