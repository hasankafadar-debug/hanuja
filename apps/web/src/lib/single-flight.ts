/**
 * Process-local single-flight: concurrent callers share one in-flight promise.
 *
 * Not a cache — once the promise settles the slot is cleared and the next call
 * computes again. Used in front of `unstable_cache` callbacks, because Next's
 * data cache does not coalesce concurrent callers on a cold miss (it only
 * dedupes the background revalidation of an already-cached stale entry).
 * A rejected computation clears the slot too, so the next caller retries.
 */
export function createSingleFlight<T>(compute: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null

  return () => {
    if (!inFlight) {
      // async IIFE: compute starts immediately, and a synchronous throw becomes
      // a rejection of the shared promise instead of escaping to one caller.
      inFlight = (async () => compute())().finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }
}
