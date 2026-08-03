/**
 * Media route handlers â€” presigned upload URL generation and asset management.
 */
import { NoSuchKey } from '@aws-sdk/client-s3'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, noContent, handleError } from '../lib/response'
import { buildManagedMediaShareUrl, extractPublicManagedMediaKey } from '../lib/media-url'
import { getMediaMaxSizeBytes, readObject } from '../lib/r2'
import { createMediaService } from '../services/media.service'
import { createPrismaForRoute } from '../lib/prisma'
import type { MediaFolder } from '../lib/r2'
import type { Prisma } from '@prisma/client'
import type { UserRole as PermissionUserRole } from '@hanuja/security'
import { NotFoundError, UnauthorizedError } from '../lib/errors'

export interface PrivateMediaViewer {
  viewerId: string
  viewerRole: PermissionUserRole
}

function getMediaService() {
  return createMediaService({ prisma: createPrismaForRoute() })
}

function getRequestOrigin(req: NextRequest) {
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }

  return new URL(req.url).origin
}

function buildMissingManagedImagePlaceholder(sourceUrl: string) {
  let label = 'Gorsel'

  try {
    const pathname = new URL(sourceUrl).pathname
    const fileName = pathname.split('/').filter(Boolean).pop()
    if (fileName) {
      label =
        fileName
          .replace(/\.[a-z0-9]+$/i, '')
          .replace(/[-_]+/g, ' ')
          .slice(0, 32) || label
    }
  } catch {
    // Keep generic label when URL parsing fails.
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-label="Gorsel bulunamadi">
  <rect width="1200" height="1200" fill="#efe6d7"/>
  <rect x="120" y="120" width="960" height="960" rx="48" fill="#f8f4ec" stroke="#d4c7b6" stroke-width="12"/>
  <text x="600" y="535" text-anchor="middle" font-family="Arial, sans-serif" font-size="52" fill="#5f5448">Gorsel bulunamadi</text>
  <text x="600" y="610" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" fill="#8a7d70">${label}</text>
</svg>`
}

function shouldServeManagedImagePlaceholder(sourceUrl: string) {
  const isProtectedPreview = process.env.PREVIEW_DEPLOYMENT === 'true'
  if (process.env.NODE_ENV === 'production' && !isProtectedPreview) return false

  try {
    const pathname = new URL(sourceUrl).pathname
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(pathname)
  } catch {
    return false
  }
}

const VALID_FOLDERS: MediaFolder[] = [
  'products',
  'stores',
  'avatars',
  'disputes',
  'returns',
  'blog',
  'documents',
]

const requestUploadSchema = z.object({
  folder: z.enum(['products', 'stores', 'avatars', 'disputes', 'returns', 'blog', 'documents']),
  mimeType: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
  originalName: z.string().max(255).optional(),
})

// POST /api/media/upload-url
export async function requestUploadUrl(req: NextRequest, ownerId: string) {
  try {
    const body = await req.json()
    const { folder, mimeType, originalName } = requestUploadSchema.parse(body)
    const svc = getMediaService()
    const result = await svc.requestUploadUrl({
      ownerId,
      folder,
      mimeType,
      ...(originalName ? { originalName } : {}),
    })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/media/:id/confirm
export async function confirmUpload(assetId: string, ownerId: string) {
  try {
    const svc = getMediaService()
    const asset = await svc.confirmUpload(assetId, ownerId)
    return ok(asset)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/media/:id
export async function deleteAsset(assetId: string, ownerId: string) {
  try {
    const svc = getMediaService()
    await svc.deleteAsset(assetId, ownerId)
    return noContent()
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/media?folder=products
export async function listAssets(req: NextRequest, ownerId: string) {
  try {
    const url = new URL(req.url)
    const folder = url.searchParams.get('folder') as MediaFolder | null
    if (folder && !VALID_FOLDERS.includes(folder)) {
      return handleError(new Error('GeÃ§ersiz klasÃ¶r'))
    }
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const svc = getMediaService()
    const result = await svc.listAssets(ownerId, folder ?? undefined, {
      limit,
      skip,
    })
    const proxyBaseUrl = getRequestOrigin(req)

    return ok({
      ...result,
      items: result.items.map((asset) => ({
        ...asset,
        shareUrl: buildManagedMediaShareUrl(asset.url, { proxyBaseUrl }) ?? asset.url,
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/media/fetch?src=https://... â€” same-origin proxy for managed public media URLs
export async function fetchPublicMedia(req: NextRequest) {
  let sourceUrl = ''

  try {
    const url = new URL(req.url)
    sourceUrl = url.searchParams.get('src')?.trim() ?? ''
    const key = extractPublicManagedMediaKey(sourceUrl)

    if (!key) {
      return new Response('GeÃ§ersiz medya kaynaÄŸÄ±.', { status: 400 })
    }

    const object = await readObject(key)
    return new Response(Buffer.from(object.body), {
      headers: {
        'Content-Type': object.contentType,
        'Content-Length': String(object.sizeBytes),
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    if (
      err instanceof NoSuchKey ||
      (typeof err === 'object' &&
        err !== null &&
        'Code' in err &&
        (err as { Code?: string }).Code === 'NoSuchKey')
    ) {
      if (shouldServeManagedImagePlaceholder(sourceUrl)) {
        return new Response(buildMissingManagedImagePlaceholder(sourceUrl), {
          headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
          },
        })
      }

      return new Response('Medya bulunamadi.', {
        status: 404,
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
        },
      })
    }

    return handleError(err)
  }
}

function privateMediaCacheHeaders(contentType: string, sizeBytes: number) {
  return {
    'Content-Type': contentType,
    'Content-Length': String(sizeBytes),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  }
}

function privateMediaNotFoundResponse() {
  return new Response('Medya bulunamadi.', {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

function privateMediaUnauthorizedResponse() {
  const response = handleError(new UnauthorizedError())
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

function privateMediaWhere(
  assetId: string,
  viewer: PrivateMediaViewer,
): Prisma.MediaAssetWhereInput {
  const base: Prisma.MediaAssetWhereInput = {
    id: assetId,
    status: 'ready',
    key: { not: null },
  }

  if (viewer.viewerRole === 'admin') return base

  return {
    ...base,
    OR: [
      { uploadedBy: viewer.viewerId },
      { dispute: { order: { customerId: viewer.viewerId } } },
      {
        dispute: {
          order: { lines: { some: { seller: { userId: viewer.viewerId } } } },
        },
      },
      { returnRequest: { customerId: viewer.viewerId } },
      {
        returnRequest: {
          order: { lines: { some: { seller: { userId: viewer.viewerId } } } },
        },
      },
      { returnMessage: { returnRequest: { customerId: viewer.viewerId } } },
      {
        returnMessage: {
          returnRequest: {
            order: { lines: { some: { seller: { userId: viewer.viewerId } } } },
          },
        },
      },
      // Support attachment access is scoped to the ticket participant. These
      // relations are explicit because support uploads have existing readers
      // outside the return/dispute workflows.
      {
        supportAttachments: {
          some: {
            message: { ticket: { seller: { userId: viewer.viewerId } } },
          },
        },
      },
      {
        customerSupportAttachments: {
          some: { message: { ticket: { customerId: viewer.viewerId } } },
        },
      },
    ],
  }
}

// GET /api/media/private/:id — authenticated, asset-ID based private media stream.
// The supplied ID is scoped through database relations before its storage key is read.
export async function fetchPrivateMedia(assetId: string, viewer: PrivateMediaViewer | null) {
  if (!viewer) return privateMediaUnauthorizedResponse()

  try {
    const prisma = createPrismaForRoute()
    const asset = await prisma.mediaAsset.findFirst({
      where: privateMediaWhere(assetId, viewer),
      select: { id: true, key: true, folder: true },
    })

    // Missing and unauthorized assets intentionally have the same response.
    if (!asset?.key) throw new NotFoundError('MediaAsset', assetId)

    const object = await readObject(
      asset.key,
      getMediaMaxSizeBytes((asset.folder as MediaFolder | null) ?? 'general'),
    )
    return new Response(Buffer.from(object.body), {
      headers: privateMediaCacheHeaders(object.contentType, object.sizeBytes),
    })
  } catch (err) {
    if (
      err instanceof NotFoundError ||
      err instanceof NoSuchKey ||
      (typeof err === 'object' &&
        err !== null &&
        'Code' in err &&
        (err as { Code?: string }).Code === 'NoSuchKey')
    ) {
      return privateMediaNotFoundResponse()
    }

    const response = handleError(err)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
