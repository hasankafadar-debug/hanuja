/**
 * Client-side types for the Duyuru (announcement) admin screens.
 * Type-only imports from the domain layer are allowed on the client; the service
 * layer (Prisma-backed) is server-only and must never be imported here.
 */
import type { AnnouncementAudience } from '@hanuja/api/domain/announcement-audience'
import type { AnnouncementProgressBucket } from '@hanuja/api/domain/announcement-progress'

export type DisplayMedia =
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string | null; posterUrl: string | null }

export interface ManualSellerRef {
  id: string
  displayName: string
  status: string
}

export interface AnnouncementDraftInitial {
  id: string
  status: 'draft'
  version: number
  title: string
  body: string
  audience: AnnouncementAudience
  audienceInvalid: boolean
  manualSellers: ManualSellerRef[]
  media: { id: string; kind: string; originalName: string | null } | null
  poster: { id: string; kind: string; originalName: string | null } | null
  displayMedia: DisplayMedia | null
  panelUrl: string
}

export interface AnnouncementSentInitial {
  id: string
  status: 'sent'
  version: number
  title: string
  body: string
  sentTitle: string | null
  sentBody: string | null
  sentAt: string | null
  editedAfterSendAt: string | null
  recipientCount: number
  displayMedia: DisplayMedia | null
  createdAt: string
}

export interface FilterLocationDistrict {
  key: string
  label: string
  count: number
}

export interface FilterLocationCity {
  key: string
  label: string
  count: number
  districts: FilterLocationDistrict[]
}

export interface FilterOptionsData {
  statuses: { value: 'active' | 'suspended'; label: string }[]
  locations: FilterLocationCity[]
  categories: { id: string; name: string; parentId: string | null }[]
}

export interface SellerSearchResult {
  id: string
  displayName: string
  status: string
  companyName: string | null
  city: string | null
  district: string | null
}

export interface RecipientPreviewRow {
  id: string
  displayName: string
  status: string
  createdAt: string
  companyName: string | null
  city: string | null
  district: string | null
  isVerified: boolean
}

export interface RecipientPreviewResult {
  version: number
  count: number
  audienceHash: string
  page: number
  pageSize: number
  rows: RecipientPreviewRow[]
  excluded: { count: number; rows: { id: string; displayName: string }[] }
}

export interface EmailPreviewResult {
  subject: string
  html: string
  text: string
}

export interface ProgressResultRow {
  id: string
  sellerName: string
  bucket: AnnouncementProgressBucket
  sellerDeleted: boolean
  dispatchCompleted: boolean
  lastError: string | null
  smtpAcceptedAt: string | null
  deliveredAt: string | null
  readAt: string | null
}

export interface ProgressResult {
  status: 'draft' | 'sent'
  recipientCount: number
  total: number
  counts: Record<AnnouncementProgressBucket, number>
  awaitingResultCount: number
  lastSmtpAcceptedAt: string | null
  page: number
  pageSize: number
  filteredTotal: number
  rows: ProgressResultRow[]
}

export interface RetryPreviewResult {
  eligibleCount: number
  eligibleHash: string
  eligible: { id: string; sellerName: string; lastError: string | null }[]
  notEligible: {
    uncertain: number
    failedButSellerDeleted: number
    stillInProgress: number
    failedTotal: number
  }
}
