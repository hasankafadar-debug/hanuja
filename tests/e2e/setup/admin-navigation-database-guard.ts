export const ADMIN_NAVIGATION_TEST_DATABASE = 'hanuja_navigation_test'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface AdminNavigationDatabaseTarget {
  hostname: string
  databaseName: string
}

export function assertAdminNavigationTestDatabase(
  databaseUrl: string | undefined,
): AdminNavigationDatabaseTarget {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the admin navigation fixture.')
  }

  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL for the admin navigation fixture.')
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Admin navigation fixtures require a PostgreSQL DATABASE_URL.')
  }

  const hostname = parsed.hostname.toLowerCase()
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!LOOPBACK_HOSTS.has(hostname) || databaseName !== ADMIN_NAVIGATION_TEST_DATABASE) {
    throw new Error(
      `Admin navigation fixtures require a loopback host and the ${ADMIN_NAVIGATION_TEST_DATABASE} database.`,
    )
  }

  return { hostname, databaseName }
}
