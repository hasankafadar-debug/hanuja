/** Call only after the stock transaction commits. Redis outages are recovered
 * by the repeatable relay reading PostgreSQL's durable dirty records. */
export async function wakeStockSearchProjection() {
  try {
    const { enqueueDirtyProductSync } = await import('../jobs/search-index-sync.job')
    if (typeof enqueueDirtyProductSync === 'function') await enqueueDirtyProductSync()
  } catch {
    /* Durable PostgreSQL state is still pending. */
  }
}
