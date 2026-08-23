import type { Prisma, PrismaClient } from '@prisma/client'
import {
  generateHomeMediaVariants,
  hasCanonicalHomeMediaVariants,
  type HomeMediaVariants,
} from '../lib/home-media-variants'
import { getManagedMediaShareUrlConfigError, normalizeManagedMediaUrl } from '../lib/media-url'
import { getMediaMaxSizeBytes, readObject, type MediaFolder } from '../lib/r2'

export const HOME_MEDIA_FOLDERS = ['slider', 'promo'] as const

type HomeMediaFolder = (typeof HOME_MEDIA_FOLDERS)[number]
type MediaAssetDelegate = PrismaClient['mediaAsset']

export interface HomeMediaOptimizerPrisma {
  mediaAsset: Pick<MediaAssetDelegate, 'findMany' | 'update'>
}

export interface HomeMediaOptimizationFailure {
  id: string
  message: string
}

export interface HomeMediaOptimizationSummary {
  mode: 'dry-run' | 'apply'
  scanned: number
  candidates: number
  optimized: number
  skipped: number
  failed: HomeMediaOptimizationFailure[]
}

type HomeMediaAsset = {
  id: string
  key: string | null
  url: string
  folder: string | null
  variants: unknown
}

type GenerateVariants = typeof generateHomeMediaVariants
type ReadObject = typeof readObject

function isUrlOnBase(url: string, publicBaseUrl: string) {
  try {
    return new URL(url).origin === new URL(publicBaseUrl).origin
  } catch {
    return false
  }
}

export function homeMediaAssetNeedsOptimization(
  asset: Pick<HomeMediaAsset, 'url' | 'variants'>,
  publicBaseUrl: string,
) {
  if (!isUrlOnBase(asset.url, publicBaseUrl)) return true
  if (!hasCanonicalHomeMediaVariants(asset.variants)) return true

  return Object.values(asset.variants).some((url) => !isUrlOnBase(url, publicBaseUrl))
}

function normalizeVariantUrls(variants: HomeMediaVariants, publicBaseUrl: string) {
  return Object.fromEntries(
    Object.entries(variants).map(([key, url]) => [
      key,
      normalizeManagedMediaUrl(url, publicBaseUrl),
    ]),
  ) as HomeMediaVariants
}

export async function optimizeHomeMediaAssets(options: {
  prisma: HomeMediaOptimizerPrisma
  apply: boolean
  publicBaseUrl: string
  readObjectFn?: ReadObject
  generateVariantsFn?: GenerateVariants
  onProgress?: (message: string) => void
}): Promise<HomeMediaOptimizationSummary> {
  const {
    prisma,
    apply,
    publicBaseUrl,
    readObjectFn = readObject,
    generateVariantsFn = generateHomeMediaVariants,
    onProgress = () => undefined,
  } = options

  const configError = getManagedMediaShareUrlConfigError(publicBaseUrl)
  if (configError) throw new Error(configError)

  const assets = (await prisma.mediaAsset.findMany({
    where: {
      folder: { in: [...HOME_MEDIA_FOLDERS] },
      kind: 'image',
      status: 'ready',
      key: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      key: true,
      url: true,
      folder: true,
      variants: true,
    },
  })) as HomeMediaAsset[]

  const candidates = assets.filter((asset) => homeMediaAssetNeedsOptimization(asset, publicBaseUrl))
  const summary: HomeMediaOptimizationSummary = {
    mode: apply ? 'apply' : 'dry-run',
    scanned: assets.length,
    candidates: candidates.length,
    optimized: 0,
    skipped: assets.length - candidates.length,
    failed: [],
  }

  if (!apply) return summary

  for (const asset of candidates) {
    if (!asset.key || !HOME_MEDIA_FOLDERS.includes(asset.folder as HomeMediaFolder)) {
      summary.failed.push({
        id: asset.id,
        message: 'Gecersiz home medya anahtari veya klasoru.',
      })
      continue
    }

    try {
      onProgress(`Optimize ediliyor: ${asset.id}`)
      const folder = asset.folder as MediaFolder
      const { body } = await readObjectFn(asset.key, getMediaMaxSizeBytes(folder))
      const generated = await generateVariantsFn(body, asset.key)
      const variants = normalizeVariantUrls(generated.variants, publicBaseUrl)

      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          url: normalizeManagedMediaUrl(asset.url, publicBaseUrl),
          variants: variants as unknown as Prisma.InputJsonValue,
          width: generated.width,
          height: generated.height,
          verifiedAt: new Date(),
        },
      })
      summary.optimized += 1
    } catch (error) {
      summary.failed.push({
        id: asset.id,
        message: error instanceof Error ? error.message : 'Bilinmeyen optimizasyon hatasi.',
      })
    }
  }

  return summary
}
