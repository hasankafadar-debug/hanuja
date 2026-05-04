/**
 * Home CMS Service — ana sayfa hero slider ve promo kart yönetimi.
 *
 * Storefront okuma: getActiveSlides / getActivePromo
 *   - Aktif pencere filtresi (startsAt <= now <= endsAt)
 *   - Sonuç Next.js revalidate: 300 ile cache'lenir
 *
 * Admin CRUD: createSlide / updateSlide / deleteSlide / reorderSlides / upsertPromo
 *   - Her mutasyon AdminAuditLog yazar
 *   - Sadece super_admin / operations_admin rolleri erişebilir (route katmanında kontrol edilir)
 *
 * Medya referans güvenliği: silme öncesi referans sayısı kontrol edilir — kullanımdaki
 * asset'ler silinemez (MediaAsset silme işlemi media.service üzerinden yapılır).
 */
import type { PrismaClient, HomePromoSlot, AdminActionType } from '@prisma/client'
import { NotFoundError, ValidationError } from '../lib/errors'

export interface HomeCmsServiceDeps {
  prisma: PrismaClient
}

// Storefront'a dönen slayt shape'i
export interface ActiveSlide {
  id: string
  sortOrder: number
  mediaAsset: {
    id: string
    kind: string
    url: string
    variants: unknown
    durationSec: number | null
  }
  posterAsset: {
    id: string
    url: string
    variants: unknown
  } | null
  eyebrow: string | null
  title: string
  body: string | null
  ctaLabel: string
  ctaHref: string
  sellerId: string | null
}

// Storefront'a dönen promo shape'i
export interface ActivePromo {
  id: string
  slot: HomePromoSlot
  mediaAsset: {
    id: string
    url: string
    variants: unknown
  }
  title: string
  subtitle: string | null
  ctaHref: string
}

// Admin CRUD input tipleri
export interface CreateSlideInput {
  mediaAssetId: string
  posterAssetId?: string | null
  eyebrow?: string | null
  title: string
  body?: string | null
  ctaLabel: string
  ctaHref: string
  startsAt?: Date | null
  endsAt?: Date | null
  sellerId?: string | null
  sortOrder?: number
  isActive?: boolean
  actorId: string
}

export interface UpdateSlideInput {
  mediaAssetId?: string
  posterAssetId?: string | null
  eyebrow?: string | null
  title?: string
  body?: string | null
  ctaLabel?: string
  ctaHref?: string
  startsAt?: Date | null
  endsAt?: Date | null
  sellerId?: string | null
  sortOrder?: number
  isActive?: boolean
  actorId: string
}

export interface UpsertPromoInput {
  mediaAssetId: string
  title: string
  subtitle?: string | null
  ctaHref: string
  startsAt?: Date | null
  endsAt?: Date | null
  isActive?: boolean
  actorId: string
}

// Aktif pencere where koşulu — startsAt/endsAt null = sınırsız
function buildActiveWindowWhere(now: Date) {
  return {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  }
}

// MediaAsset include shape'i — storefront ve admin list için tekrar kullanılır
const mediaAssetSelect = {
  id: true,
  kind: true,
  url: true,
  variants: true,
  durationSec: true,
  width: true,
  height: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
} as const

export function createHomeCmsService({ prisma }: HomeCmsServiceDeps) {
  // ---------------------------------------------------------------------------
  // Storefront okuma — cache edilir, performans kritik
  // ---------------------------------------------------------------------------

  async function getActiveSlides(): Promise<ActiveSlide[]> {
    const now = new Date()
    return prisma.homeSlide.findMany({
      where: buildActiveWindowWhere(now),
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        sortOrder: true,
        eyebrow: true,
        title: true,
        body: true,
        ctaLabel: true,
        ctaHref: true,
        sellerId: true,
        mediaAsset: {
          select: {
            id: true,
            kind: true,
            url: true,
            variants: true,
            durationSec: true,
          },
        },
        posterAsset: {
          select: {
            id: true,
            url: true,
            variants: true,
          },
        },
      },
    })
  }

  async function getActivePromo(slot: HomePromoSlot): Promise<ActivePromo | null> {
    const now = new Date()
    return prisma.homePromo.findFirst({
      where: {
        slot,
        ...buildActiveWindowWhere(now),
      },
      select: {
        id: true,
        slot: true,
        title: true,
        subtitle: true,
        ctaHref: true,
        mediaAsset: {
          select: {
            id: true,
            url: true,
            variants: true,
          },
        },
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Admin okuma
  // ---------------------------------------------------------------------------

  async function listAllSlides() {
    return prisma.homeSlide.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        mediaAsset: { select: mediaAssetSelect },
        posterAsset: { select: mediaAssetSelect },
        seller: { select: { id: true, displayName: true, slug: true } },
      },
    })
  }

  async function getSlideById(id: string) {
    const slide = await prisma.homeSlide.findUnique({
      where: { id },
      include: {
        mediaAsset: { select: mediaAssetSelect },
        posterAsset: { select: mediaAssetSelect },
        seller: { select: { id: true, displayName: true, slug: true } },
      },
    })
    if (!slide) throw new NotFoundError('Slayt bulunamadı.')
    return slide
  }

  async function listAllPromos() {
    return prisma.homePromo.findMany({
      orderBy: { slot: 'asc' },
      include: {
        mediaAsset: { select: mediaAssetSelect },
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD — her mutasyon AdminAuditLog yazar
  // ---------------------------------------------------------------------------

  async function createSlide(input: CreateSlideInput) {
    const { actorId, ...data } = input

    // Video ise poster zorunlu
    const asset = await prisma.mediaAsset.findUnique({ where: { id: data.mediaAssetId } })
    if (!asset) throw new NotFoundError('Medya dosyası bulunamadı.')
    if (asset.kind === 'video' && !data.posterAssetId) {
      throw new ValidationError('Video slaytlarda poster görseli zorunludur.')
    }

    const slide = await prisma.$transaction(async (tx) => {
      const created = await tx.homeSlide.create({
        data: {
          mediaAssetId: data.mediaAssetId,
          posterAssetId: data.posterAssetId ?? null,
          eyebrow: data.eyebrow ?? null,
          title: data.title,
          body: data.body ?? null,
          ctaLabel: data.ctaLabel,
          ctaHref: data.ctaHref,
          startsAt: data.startsAt ?? null,
          endsAt: data.endsAt ?? null,
          sellerId: data.sellerId ?? null,
          sortOrder: data.sortOrder ?? 0,
          isActive: data.isActive ?? true,
          createdBy: actorId,
        },
      })

      await tx.adminAuditLog.create({
        data: {
          actorId,
          actionType: 'home_slide_created' as AdminActionType,
          targetType: 'home_slide',
          targetId: created.id,
          newData: { title: created.title, mediaAssetId: created.mediaAssetId, sortOrder: created.sortOrder },
        },
      })

      return created
    })

    return slide
  }

  async function updateSlide(id: string, input: UpdateSlideInput) {
    const { actorId, ...data } = input
    const existing = await getSlideById(id)

    // Video'ya geçiş yapılıyorsa poster kontrolü
    const targetMediaId = data.mediaAssetId ?? existing.mediaAssetId
    if (data.mediaAssetId) {
      const asset = await prisma.mediaAsset.findUnique({ where: { id: data.mediaAssetId } })
      if (!asset) throw new NotFoundError('Medya dosyası bulunamadı.')
      const newPoster = data.posterAssetId !== undefined ? data.posterAssetId : existing.posterAssetId
      if (asset.kind === 'video' && !newPoster) {
        throw new ValidationError('Video slaytlarda poster görseli zorunludur.')
      }
    }
    void targetMediaId

    const slide = await prisma.$transaction(async (tx) => {
      const updated = await tx.homeSlide.update({
        where: { id },
        data: {
          ...(data.mediaAssetId !== undefined && { mediaAssetId: data.mediaAssetId }),
          ...(data.posterAssetId !== undefined && { posterAssetId: data.posterAssetId }),
          ...(data.eyebrow !== undefined && { eyebrow: data.eyebrow }),
          ...(data.title !== undefined && { title: data.title }),
          ...(data.body !== undefined && { body: data.body }),
          ...(data.ctaLabel !== undefined && { ctaLabel: data.ctaLabel }),
          ...(data.ctaHref !== undefined && { ctaHref: data.ctaHref }),
          ...(data.startsAt !== undefined && { startsAt: data.startsAt }),
          ...(data.endsAt !== undefined && { endsAt: data.endsAt }),
          ...(data.sellerId !== undefined && { sellerId: data.sellerId }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      })

      await tx.adminAuditLog.create({
        data: {
          actorId,
          actionType: 'home_slide_updated' as AdminActionType,
          targetType: 'home_slide',
          targetId: id,
          previousData: {
            title: existing.title,
            isActive: existing.isActive,
            sortOrder: existing.sortOrder,
          },
          newData: {
            title: updated.title,
            isActive: updated.isActive,
            sortOrder: updated.sortOrder,
          },
        },
      })

      return updated
    })

    return slide
  }

  async function deleteSlide(id: string, actorId: string) {
    const existing = await getSlideById(id)

    await prisma.$transaction(async (tx) => {
      await tx.homeSlide.delete({ where: { id } })

      await tx.adminAuditLog.create({
        data: {
          actorId,
          actionType: 'home_slide_deleted' as AdminActionType,
          targetType: 'home_slide',
          targetId: id,
          previousData: {
            title: existing.title,
            mediaAssetId: existing.mediaAssetId,
            isActive: existing.isActive,
          },
        },
      })
    })
  }

  // Slaytları drag-drop sırasına göre günceller — ids dizisi yeni sortOrder sırasını verir
  async function reorderSlides(ids: string[], actorId: string) {
    if (ids.length === 0) throw new ValidationError('En az bir slayt ID gereklidir.')

    await prisma.$transaction(async (tx) => {
      await Promise.all(
        ids.map((id, index) =>
          tx.homeSlide.update({ where: { id }, data: { sortOrder: index } }),
        ),
      )

      await tx.adminAuditLog.create({
        data: {
          actorId,
          actionType: 'home_slide_reordered' as AdminActionType,
          targetType: 'home_slide',
          targetId: 'batch',
          newData: { orderedIds: ids },
        },
      })
    })
  }

  // Promo slot upsert — her slot için tek kayıt (unique constraint ile garanti edilir)
  async function upsertPromo(slot: HomePromoSlot, input: UpsertPromoInput) {
    const { actorId, ...data } = input

    const asset = await prisma.mediaAsset.findUnique({ where: { id: data.mediaAssetId } })
    if (!asset) throw new NotFoundError('Medya dosyası bulunamadı.')
    if (asset.kind === 'video') {
      throw new ValidationError('Promo kartlarda video kullanılamaz, yalnızca görsel kabul edilir.')
    }

    const existing = await prisma.homePromo.findUnique({ where: { slot } })

    const promo = await prisma.$transaction(async (tx) => {
      const upserted = await tx.homePromo.upsert({
        where: { slot },
        create: {
          slot,
          mediaAssetId: data.mediaAssetId,
          title: data.title,
          subtitle: data.subtitle ?? null,
          ctaHref: data.ctaHref,
          startsAt: data.startsAt ?? null,
          endsAt: data.endsAt ?? null,
          isActive: data.isActive ?? true,
          createdBy: actorId,
        },
        update: {
          mediaAssetId: data.mediaAssetId,
          title: data.title,
          subtitle: data.subtitle ?? null,
          ctaHref: data.ctaHref,
          ...(data.startsAt !== undefined && { startsAt: data.startsAt }),
          ...(data.endsAt !== undefined && { endsAt: data.endsAt }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      })

      await tx.adminAuditLog.create({
        data: {
          actorId,
          actionType: 'home_promo_updated' as AdminActionType,
          targetType: 'home_promo',
          targetId: upserted.id,
          ...(existing
            ? { previousData: { title: existing.title, isActive: existing.isActive } }
            : {}),
          newData: { slot, title: upserted.title, isActive: upserted.isActive },
        },
      })

      return upserted
    })

    return promo
  }

  return {
    // Storefront
    getActiveSlides,
    getActivePromo,
    // Admin okuma
    listAllSlides,
    getSlideById,
    listAllPromos,
    // Admin CRUD
    createSlide,
    updateSlide,
    deleteSlide,
    reorderSlides,
    upsertPromo,
  }
}

export type HomeCmsService = ReturnType<typeof createHomeCmsService>
