/**
 * Announcement service (e-mail plan phase 5) — rules that do not need a database:
 * draft conflicts, media attachment rules, seller-side ownership and read state.
 * Send, progress, retry and the dispatch sweep run against PostgreSQL in
 * tests/postgres/announcement-send.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError, ValidationError } from '../../../api/lib/errors'
import { createAnnouncementService } from '../../../api/services/announcement.service'
import type { AnnouncementAudience } from '../../../api/domain/announcement-audience'

const AUDIENCE: AnnouncementAudience = { mode: 'all', filters: {}, manualSellerIds: [], excludedSellerIds: [] }

function draftInput(overrides: Record<string, unknown> = {}) {
  return {
    version: 3,
    title: '  Kargo kuralı  ',
    body: ' Metin ',
    mediaAssetId: null,
    posterAssetId: null,
    audience: AUDIENCE,
    ...overrides,
  }
}

function mediaRow(id: string, overrides: Record<string, unknown> = {}) {
  return { id, status: 'ready', folder: 'announcements', kind: 'image', ...overrides }
}

function prismaMock(overrides: Record<string, unknown> = {}) {
  return {
    announcement: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ status: 'draft' }),
    },
    mediaAsset: { findMany: vi.fn().mockResolvedValue([]) },
    announcementRecipient: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(),
    ...overrides,
  } as any
}

describe('updateDraft', () => {
  it('saves trimmed content and bumps the version it read', async () => {
    const prisma = prismaMock()
    await expect(createAnnouncementService({ prisma }).updateDraft('a1', draftInput())).resolves.toEqual({
      version: 4,
    })
    expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: 'draft', version: 3 },
      data: expect.objectContaining({ title: 'Kargo kuralı', body: 'Metin', version: { increment: 1 } }),
    })
  })

  it('explains why a save did not apply', async () => {
    const prisma = prismaMock()
    prisma.announcement.updateMany.mockResolvedValue({ count: 0 })
    const service = createAnnouncementService({ prisma })

    prisma.announcement.findUnique.mockResolvedValue({ status: 'draft' })
    await expect(service.updateDraft('a1', draftInput())).rejects.toThrow(
      'Taslak başka bir sekmede veya başka bir yönetici tarafından değiştirildi',
    )
    prisma.announcement.findUnique.mockResolvedValue({ status: 'sent' })
    await expect(service.updateDraft('a1', draftInput())).rejects.toBeInstanceOf(ConflictError)
    prisma.announcement.findUnique.mockResolvedValue(null)
    await expect(service.updateDraft('a1', draftInput())).rejects.toBeInstanceOf(NotFoundError)
  })

  it('maps a media row deleted between check and write to a validation error', async () => {
    const prisma = prismaMock()
    prisma.mediaAsset.findMany.mockResolvedValue([mediaRow('m1')])
    prisma.announcement.updateMany.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }))
    await expect(
      createAnnouncementService({ prisma }).updateDraft('a1', draftInput({ mediaAssetId: 'm1' })),
    ).rejects.toThrow('Seçilen medya silinmiş')
  })

  it.each([
    ['another folder', mediaRow('m1', { folder: 'slider' })],
    ['a pending upload', mediaRow('m1', { status: 'pending' })],
    ['a document', mediaRow('m1', { kind: 'document' })],
  ])('refuses %s as announcement media', async (_label, row) => {
    const prisma = prismaMock()
    prisma.mediaAsset.findMany.mockResolvedValue([row])
    await expect(
      createAnnouncementService({ prisma }).updateDraft('a1', draftInput({ mediaAssetId: 'm1' })),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(prisma.announcement.updateMany).not.toHaveBeenCalled()
  })

  it('accepts a poster only for a video, and only as an image', async () => {
    const prisma = prismaMock()
    const service = createAnnouncementService({ prisma })

    prisma.mediaAsset.findMany.mockResolvedValue([mediaRow('m1'), mediaRow('p1')])
    await expect(
      service.updateDraft('a1', draftInput({ mediaAssetId: 'm1', posterAssetId: 'p1' })),
    ).rejects.toThrow('Kapak görseli yalnız video için seçilebilir.')

    prisma.mediaAsset.findMany.mockResolvedValue([
      mediaRow('m1', { kind: 'video' }),
      mediaRow('p1', { kind: 'video' }),
    ])
    await expect(
      service.updateDraft('a1', draftInput({ mediaAssetId: 'm1', posterAssetId: 'p1' })),
    ).rejects.toThrow('Seçilen kapak görseli kullanılamıyor')

    prisma.mediaAsset.findMany.mockResolvedValue([mediaRow('m1', { kind: 'video' }), mediaRow('p1')])
    await expect(
      service.updateDraft('a1', draftInput({ mediaAssetId: 'm1', posterAssetId: 'p1' })),
    ).resolves.toEqual({ version: 4 })
  })

  it('bounds the content length', async () => {
    const service = createAnnouncementService({ prisma: prismaMock() })
    await expect(service.updateDraft('a1', draftInput({ title: 'x'.repeat(151) }))).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(service.updateDraft('a1', draftInput({ body: 'x'.repeat(5001) }))).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe('deleteDraft', () => {
  it('never deletes a sent announcement', async () => {
    const prisma = prismaMock()
    prisma.announcement.deleteMany.mockResolvedValue({ count: 0 })
    prisma.announcement.findUnique.mockResolvedValue({ status: 'sent' })
    await expect(createAnnouncementService({ prisma }).deleteDraft('a1')).rejects.toThrow(
      'Gönderilmiş duyuru silinemez.',
    )
    expect(prisma.announcement.deleteMany).toHaveBeenCalledWith({ where: { id: 'a1', status: 'draft' } })
  })
})

describe('retryFailed', () => {
  it('requires an audit reason before touching the database', async () => {
    const prisma = prismaMock()
    await expect(
      createAnnouncementService({ prisma }).retryFailed('admin-1', 'a1', {
        reason: 'kısa',
        eligibleHash: 'a'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('seller side', () => {
  it('marks read only once and only for the addressed seller', async () => {
    const prisma = prismaMock()
    const service = createAnnouncementService({ prisma })

    await expect(service.markRead('s1', 'a1')).resolves.toEqual({ advanced: true })
    expect(prisma.announcementRecipient.updateMany).toHaveBeenCalledWith({
      where: { announcementId: 'a1', sellerId: 's1', readAt: null },
      data: { readAt: expect.any(Date) },
    })

    prisma.announcementRecipient.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.markRead('s1', 'a1')).resolves.toEqual({ advanced: false })

    prisma.announcementRecipient.count.mockResolvedValue(0)
    await expect(service.markRead('s2', 'a1')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns an announcement only through the seller’s own recipient row', async () => {
    const prisma = prismaMock()
    await expect(createAnnouncementService({ prisma }).getForSeller('s2', 'a1')).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect(prisma.announcementRecipient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { announcementId: 'a1', sellerId: 's2' } }),
    )
  })
})
