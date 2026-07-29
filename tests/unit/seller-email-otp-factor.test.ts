import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  SELLER_EMAIL_OTP_FACTOR_SECRET,
  ensureSellerEmailOtpFactor,
} from '../../apps/seller-panel/src/lib/seller-email-otp-factor'

describe('seller email OTP factor marker', () => {
  it('creates a non-TOTP marker without backup codes when it is missing', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined)

    await ensureSellerEmailOtpFactor({ twoFactor: { upsert } }, 'seller-user-1')

    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'seller-user-1' },
      update: {},
      create: {
        userId: 'seller-user-1',
        secret: SELLER_EMAIL_OTP_FACTOR_SECRET,
        backupCodes: '[]',
        verified: false,
      },
    })
  })

  it('is idempotent and preserves an existing TOTP record', async () => {
    const records = new Map([
      [
        'admin-user-1',
        {
          userId: 'admin-user-1',
          secret: 'encrypted-admin-totp-secret',
          backupCodes: 'encrypted-admin-backup-codes',
          verified: true,
        },
      ],
    ])
    const upsert = vi.fn(async (args: {
      where: { userId: string }
      update: Record<string, never>
      create: {
        userId: string
        secret: string
        backupCodes: string
        verified: boolean
      }
    }) => {
      const existing = records.get(args.where.userId)
      if (existing) {
        records.set(args.where.userId, { ...existing, ...args.update })
        return existing
      }
      records.set(args.where.userId, args.create)
      return args.create
    })
    const client = { twoFactor: { upsert } }

    await ensureSellerEmailOtpFactor(client, 'seller-user-1')
    await ensureSellerEmailOtpFactor(client, 'seller-user-1')
    await ensureSellerEmailOtpFactor(client, 'admin-user-1')

    expect(records.size).toBe(2)
    expect(records.get('admin-user-1')).toEqual({
      userId: 'admin-user-1',
      secret: 'encrypted-admin-totp-secret',
      backupCodes: 'encrypted-admin-backup-codes',
      verified: true,
    })
  })
})

describe('seller email OTP migration contract', () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      '../../db/schema/migrations/20260729143000_seller_email_otp_factor_backfill/migration.sql',
    ),
    'utf8',
  )

  it('enables only seller accounts and inserts only missing marker rows', () => {
    expect(migration).toContain(`WHERE "role" = 'seller'`)
    expect(migration).toContain(`WHERE "users"."role" = 'seller'`)
    expect(migration).toContain('AND NOT EXISTS')
    expect(migration).toContain('ON CONFLICT ("userId") DO NOTHING')
  })

  it('creates an unverified marker with no backup codes', () => {
    expect(migration).toContain(`'seller-email-otp-only-v1'`)
    expect(migration).toContain(`'[]'`)
    expect(migration).toMatch(/'\[\]'\s*,\s*"users"\."id"\s*,\s*false/)
  })
})
