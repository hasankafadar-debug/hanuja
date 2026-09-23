/**
 * Announcement content helpers: e-mail cover choice, frozen e-mail content and the
 * media URLs the panels play (never through the Range-less proxy).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  announcementCoverImageUrl,
  announcementDisplayMedia,
  loadSentAnnouncementEmail,
} from '../../../api/services/announcement-content'

const IMAGE = { url: 'https://media.hanuja.tr/announcements/admin-1/a.jpg', kind: 'image' as const }
const VIDEO = { url: 'https://media.hanuja.tr/announcements/admin-1/v.mp4', kind: 'video' as const }
const POSTER = { url: 'https://media.hanuja.tr/announcements/admin-1/p.png', kind: 'image' as const }

afterEach(() => vi.unstubAllEnvs())

describe('announcementCoverImageUrl', () => {
  it('uses the image itself, or the poster of a video', () => {
    vi.stubEnv('R2_PUBLIC_URL', 'https://media.hanuja.tr')
    expect(announcementCoverImageUrl(IMAGE, null)).toBe(IMAGE.url)
    expect(announcementCoverImageUrl(VIDEO, POSTER)).toBe(POSTER.url)
    expect(announcementCoverImageUrl(VIDEO, null)).toBeNull()
    expect(announcementCoverImageUrl(null, POSTER)).toBeNull()
  })
})

describe('announcementDisplayMedia', () => {
  it('plays a video straight from the media host', () => {
    vi.stubEnv('R2_PUBLIC_URL', 'https://media.hanuja.tr')
    expect(announcementDisplayMedia(VIDEO, POSTER)).toEqual({
      kind: 'video',
      url: VIDEO.url,
      posterUrl: POSTER.url,
    })
    expect(announcementDisplayMedia(IMAGE, null)).toEqual({ kind: 'image', url: IMAGE.url })
    expect(announcementDisplayMedia(null, null)).toBeNull()
  })

  it('withholds the video when the media host is not configured, keeping the poster', () => {
    vi.stubEnv('R2_PUBLIC_URL', '')
    expect(announcementDisplayMedia(VIDEO, POSTER)).toEqual({
      kind: 'video',
      url: null,
      posterUrl: POSTER.url,
    })
  })
})

describe('loadSentAnnouncementEmail', () => {
  const recipient = { sellerName: 'Atelier Noa', panelUrl: 'https://satici.hanuja.com.tr/duyurular/a1' }

  it('renders the frozen title and body', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      status: 'sent',
      sentTitle: 'Gönderilen başlık',
      sentBody: 'Gönderilen metin',
      mediaAsset: null,
      posterAsset: null,
    })
    const email = await loadSentAnnouncementEmail({ announcement: { findUnique } } as never, 'a1', recipient)
    expect(email.subject).toBe('Hanuja Duyurusu: Gönderilen başlık')
    expect(email.text).toContain('Gönderilen metin')
    expect(findUnique.mock.calls[0]![0].select).not.toHaveProperty('title')
  })

  it('refuses a draft or a missing announcement', async () => {
    for (const row of [
      null,
      { status: 'draft', sentTitle: null, sentBody: null, mediaAsset: null, posterAsset: null },
    ]) {
      const findUnique = vi.fn().mockResolvedValue(row)
      await expect(
        loadSentAnnouncementEmail({ announcement: { findUnique } } as never, 'a1', recipient),
      ).rejects.toThrow('EMAIL_DATA_MISSING:announcement')
    }
  })
})
