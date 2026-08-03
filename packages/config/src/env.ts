/**
 * Runtime environment variable validation.
 *
 * Call validateEnv() once at application startup (instrumentation.ts / worker entrypoint).
 * Throws with a clear message listing every missing or invalid variable so the
 * container crashes fast with an actionable error rather than silently misbehaving.
 *
 * Non-production CI builds may skip validation with SKIP_ENV_VALIDATION=true.
 * Production always validates, even if that variable is set.
 */
import { z } from 'zod'

export const MIN_RUNTIME_SECRET_LENGTH = 32

const KNOWN_INSECURE_SECRET_VALUES = new Set([
  'change-me-in-production',
  'turnstile-secret-not-configured',
  'replace-with-long-random-string',
  'your-secret-here',
  'dev-turnstile-bypass',
])

function isKnownInsecureSecret(value: string): boolean {
  return KNOWN_INSECURE_SECRET_VALUES.has(value.trim().toLowerCase())
}

/**
 * Reads a server-only runtime secret without ever falling back to a value that
 * could be known to an attacker. Errors deliberately include the variable name
 * but never its value.
 */
export function requireRuntimeSecret(
  name: string,
  value: string | undefined,
  minLength = MIN_RUNTIME_SECRET_LENGTH,
): string {
  const secret = value?.trim()

  if (!secret) throw new Error(`${name} must be configured`)
  if (isKnownInsecureSecret(secret)) throw new Error(`${name} must not use a placeholder value`)
  if (secret.length < minLength) throw new Error(`${name} must be at least ${minLength} characters`)

  return secret
}

const envSchema = z.object({
  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // ── Better Auth ───────────────────────────────────────────────────────────
  BETTER_AUTH_SECRET: z
    .string()
    .min(
      MIN_RUNTIME_SECRET_LENGTH,
      `BETTER_AUTH_SECRET must be at least ${MIN_RUNTIME_SECRET_LENGTH} characters`,
    )
    .refine(
      (value) => !isKnownInsecureSecret(value),
      'BETTER_AUTH_SECRET must not use a placeholder value',
    ),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),

  // ── Meilisearch ───────────────────────────────────────────────────────────
  MEILISEARCH_URL: z.string().url('MEILISEARCH_URL must be a valid URL'),
  MEILISEARCH_ADMIN_KEY: z.string().min(1, 'MEILISEARCH_ADMIN_KEY is required'),

  // ── Node ──────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  AUTO_APPROVE_CLEAN_PRODUCTS: z.enum(['true', 'false']).optional(),
})

/**
 * Validates all required environment variables.
 * Call once at startup — before any route handlers or worker queues are initialised.
 */
export function shouldSkipEnvValidation(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV'] !== 'production' && env['SKIP_ENV_VALIDATION'] === 'true'
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (shouldSkipEnvValidation(env)) {
    return
  }

  const result = envSchema.safeParse(env)

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
