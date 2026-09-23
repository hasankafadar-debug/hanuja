/**
 * Announcement content helpers shared by the dispatcher, the admin preview and the
 * seller panel: the e-mail rendering, the panel link and the media URLs to display.
 */
import type { PrismaClient } from '@prisma/client'
import { sellerAnnouncementTemplate, type EmailTemplate } from '../lib/email-templates'
import { resolveEmailImageUrl } from '../lib/email-line-items'
import {
  getManagedMediaShareUrlConfigError,
  normalizeManagedMediaUrl,
  normalizeMediaDisplayUrl,
} from '../lib/media-url'
import { getSellerPanelUrl } from '../lib/platform-info'

export interface AnnouncementMediaRef {
  url: string
  kind: 'image' | 'video' | 'document'
}

export function announcementPanelUrl(announcementId: string): string {
  return `${getSellerPanelUrl()}/duyurular/${encodeURIComponent(announcementId)}`
}

/** E-mail cover: the image itself, or the poster of a video. Never a WebP variant. */
export function announcementCoverImageUrl(
  media: AnnouncementMediaRef | null | undefined,
  poster: AnnouncementMediaRef | null | undefined,
): string | null {
  const source = media?.kind === 'image' ? media : media?.kind === 'video' ? poster : null
  return source ? resolveEmailImageUrl([{ url: source.url }]) : null
}

export function buildAnnouncementEmail(input: {
  sellerName: string
  title: string
  body: string
  media: AnnouncementMediaRef | null | undefined
  poster: AnnouncementMediaRef | null | undefined
  panelUrl: string
}): EmailTemplate {
  return sellerAnnouncementTemplate({
    sellerName: input.sellerName,
    title: input.title,
    body: input.body,
    panelUrl: input.panelUrl,
    coverImageUrl: announcementCoverImageUrl(input.media, input.poster),
    isVideo: input.media?.kind === 'video',
  })
}

/**
 * The e-mail a recipient receives: always the content frozen at send time, so a
 * retry after a post-send edit repeats what everybody else got. Media is locked
 * once sent, so the current media relation is the sent media.
 */
export async function loadSentAnnouncementEmail(
  prisma: Pick<PrismaClient, 'announcement'>,
  announcementId: string,
  recipient: { sellerName: string; panelUrl: string },
): Promise<EmailTemplate> {
  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: {
      status: true,
      sentTitle: true,
      sentBody: true,
      mediaAsset: { select: { url: true, kind: true } },
      posterAsset: { select: { url: true, kind: true } },
    },
  })
  if (
    !announcement ||
    announcement.status !== 'sent' ||
    !announcement.sentTitle ||
    announcement.sentBody === null
  ) {
    throw new Error('EMAIL_DATA_MISSING:announcement')
  }
  return buildAnnouncementEmail({
    sellerName: recipient.sellerName,
    title: announcement.sentTitle,
    body: announcement.sentBody,
    media: announcement.mediaAsset,
    poster: announcement.posterAsset,
    panelUrl: recipient.panelUrl,
  })
}

export type AnnouncementDisplayMedia =
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string | null; posterUrl: string | null }

/**
 * Media for the panels. A video is played straight from the public media host: the
 * app's media proxy has no HTTP Range support, which iOS Safari needs. When the media
 * host is not configured the video URL is withheld and only the poster is shown.
 */
export function announcementDisplayMedia(
  media: AnnouncementMediaRef | null | undefined,
  poster: AnnouncementMediaRef | null | undefined,
): AnnouncementDisplayMedia | null {
  if (!media) return null
  if (media.kind === 'image') return { kind: 'image', url: normalizeMediaDisplayUrl(media.url) }
  if (media.kind !== 'video') return null
  return {
    kind: 'video',
    url: getManagedMediaShareUrlConfigError() ? null : normalizeManagedMediaUrl(media.url),
    posterUrl: poster ? normalizeMediaDisplayUrl(poster.url) : null,
  }
}
