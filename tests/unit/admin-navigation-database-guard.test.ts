import { describe, expect, it } from 'vitest'
import {
  ADMIN_NAVIGATION_TEST_DATABASE,
  assertAdminNavigationTestDatabase,
} from '../e2e/setup/admin-navigation-database-guard'

describe('admin navigation fixture database guard', () => {
  it('rejects a missing DATABASE_URL', () => {
    expect(() => assertAdminNavigationTestDatabase(undefined)).toThrow(/DATABASE_URL is required/)
  })

  it('rejects the local development database', () => {
    expect(() =>
      assertAdminNavigationTestDatabase('postgresql://user:password@localhost:5432/hanuja_dev'),
    ).toThrow(new RegExp(ADMIN_NAVIGATION_TEST_DATABASE))
  })

  it('rejects the isolated database name on a remote host', () => {
    expect(() =>
      assertAdminNavigationTestDatabase(
        'postgresql://user:password@db.example.test:5432/hanuja_navigation_test',
      ),
    ).toThrow(/loopback host/)
  })

  it.each(['localhost', '127.0.0.1'])(
    'accepts the isolated database on loopback host %s',
    (hostname) => {
      expect(
        assertAdminNavigationTestDatabase(
          `postgresql://user:password@${hostname}:15432/hanuja_navigation_test`,
        ),
      ).toEqual({ hostname, databaseName: ADMIN_NAVIGATION_TEST_DATABASE })
    },
  )
})
