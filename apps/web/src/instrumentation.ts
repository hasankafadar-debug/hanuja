/**
 * Next.js instrumentation hook — runs once before any routes are initialised.
 * Validates required environment variables so the container crashes fast
 * with an actionable error if config is missing.
 *
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { validateEnv } = await import('@hanuja/config/env')
    validateEnv()
  }
}
