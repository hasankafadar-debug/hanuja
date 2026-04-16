/**
 * Runtime environment variable validation.
 *
 * Call validateEnv() once at application startup (instrumentation.ts / worker entrypoint).
 * Throws with a clear message listing every missing or invalid variable so the
 * container crashes fast with an actionable error rather than silently misbehaving.
 *
 * Skip validation in CI builds by setting SKIP_ENV_VALIDATION=true.
 */
import { z } from 'zod'

const envSchema = z.object({
  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // ── Better Auth ───────────────────────────────────────────────────────────
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),

  // ── Meilisearch ───────────────────────────────────────────────────────────
  MEILISEARCH_URL: z.string().url('MEILISEARCH_URL must be a valid URL'),
  MEILISEARCH_ADMIN_KEY: z.string().min(1, 'MEILISEARCH_ADMIN_KEY is required'),

  // ── Node ──────────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
})

/**
 * Validates all required environment variables.
 * Call once at startup — before any route handlers or worker queues are initialised.
 */
export function validateEnv(): void {
  if (process.env['SKIP_ENV_VALIDATION'] === 'true') {
    return
  }

  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    console.error(
      '\n[env] ❌ Missing or invalid environment variables:\n' +
        missing +
        '\n\nCopy .env.example → .env and fill in the required values.\n',
    )

    process.exit(1)
  }
}
