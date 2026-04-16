/**
 * Media route handlers — presigned upload URL generation and asset management.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, noContent, handleError } from '../lib/response'
import { createMediaService } from '../services/media.service'
import { createPrismaForRoute } from '../lib/prisma'
import type { MediaFolder } from '../lib/r2'

function getMediaService() {
  return createMediaService({ prisma: createPrismaForRoute() })
}

const VALID_FOLDERS: MediaFolder[] = ['products', 'stores', 'avatars', 'disputes', 'returns', 'blog']

const requestUploadSchema = z.object({
  folder: z.enum(['products', 'stores', 'avatars', 'disputes', 'returns', 'blog']),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
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
      return handleError(new Error('Geçersiz klasör'))
    }
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const svc = getMediaService()
    const assets = await svc.listAssets(ownerId, folder ?? undefined, { limit, skip })
    return ok(assets)
  } catch (err) {
    return handleError(err)
  }
}
