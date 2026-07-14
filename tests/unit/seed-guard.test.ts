import { describe, expect, it } from 'vitest'
import { isLocalDatabaseUrl } from '../../db/seeds/seed-guard'

describe('isLocalDatabaseUrl', () => {
  it('accepts localhost with both scheme spellings, credentials and ports', () => {
    expect(isLocalDatabaseUrl('postgresql://ci:ci@localhost:5432/ci')).toBe(true)
    expect(isLocalDatabaseUrl('postgres://ci:ci@localhost:5432/ci')).toBe(true)
    expect(isLocalDatabaseUrl('postgresql://localhost/hanuja')).toBe(true)
  })

  it('accepts 127.0.0.1 with credentials and ports', () => {
    expect(isLocalDatabaseUrl('postgresql://user:pass@127.0.0.1:5432/db')).toBe(true)
    expect(isLocalDatabaseUrl('postgres://127.0.0.1:5432/db')).toBe(true)
  })

  it('accepts IPv6 loopback ::1 (bracketed host form)', () => {
    expect(isLocalDatabaseUrl('postgresql://user:pass@[::1]:5432/db')).toBe(true)
    expect(isLocalDatabaseUrl('postgres://[::1]:5432/db')).toBe(true)
  })

  it('rejects remote hosts even with valid postgres scheme', () => {
    expect(isLocalDatabaseUrl('postgresql://user:pass@db.prod.internal:5432/hanuja')).toBe(false)
    expect(isLocalDatabaseUrl('postgres://user:pass@10.0.0.5:5432/hanuja')).toBe(false)
    expect(isLocalDatabaseUrl('postgresql://user:pass@localhost.evil.com:5432/db')).toBe(false)
  })

  it('rejects non-postgres schemes pointing at localhost', () => {
    expect(isLocalDatabaseUrl('mysql://root@localhost:3306/db')).toBe(false)
    expect(isLocalDatabaseUrl('http://localhost:5432/db')).toBe(false)
  })

  it('rejects the empty string (fail-closed)', () => {
    expect(isLocalDatabaseUrl('')).toBe(false)
    expect(isLocalDatabaseUrl('   ')).toBe(false)
  })

  it('rejects garbage / unparseable input (fail-closed)', () => {
    expect(isLocalDatabaseUrl('not-a-url')).toBe(false)
    expect(isLocalDatabaseUrl('localhost:5432')).toBe(false)
    expect(isLocalDatabaseUrl('://@:/')).toBe(false)
  })
})
