import sharp from 'sharp'
import { uploadBufferWithKey } from './r2'

export const HOME_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const HOME_MEDIA_VARIANT_SPECS = [400, 800, 1200, 1600] as const
export const HOME_MEDIA_WEBP_QUALITY = 82
export const MAX_MEDIA_IMAGE_DIMENSION = 6000
export const MAX_MEDIA_INPUT_PIXELS = MAX_MEDIA_IMAGE_DIMENSION * MAX_MEDIA_IMAGE_DIMENSION
export const SHARP_INPUT_OPTIONS = {
  limitInputPixels: MAX_MEDIA_INPUT_PIXELS,
} as const

export type HomeMediaVariantWidth = (typeof HOME_MEDIA_VARIANT_SPECS)[number]
export type HomeMediaVariantKey = `${HomeMediaVariantWidth}w`
export type HomeMediaVariants = Record<HomeMediaVariantKey, string>

type UploadVariant = typeof uploadBufferWithKey

export function homeMediaVariantKey(originalKey: string, width: HomeMediaVariantWidth) {
  const dotIndex = originalKey.lastIndexOf('.')
  const base = dotIndex >= 0 ? originalKey.slice(0, dotIndex) : originalKey
  return `${base}_${width}w.webp`
}

export async function generateHomeMediaVariants(
  originalBytes: Uint8Array,
  originalKey: string,
  sharpFactory: typeof sharp = sharp,
  uploadVariant: UploadVariant = uploadBufferWithKey,
): Promise<{ variants: HomeMediaVariants; width: number; height: number }> {
  const input = Buffer.from(originalBytes)
  const metadata = await sharpFactory(input, SHARP_INPUT_OPTIONS).metadata()
  const originalWidth = metadata.width ?? 0
  const originalHeight = metadata.height ?? 0

  if (originalWidth <= 0 || originalHeight <= 0) {
    throw new Error(`Gorsel boyutlari okunamadi: ${originalKey}`)
  }

  const variants = {} as HomeMediaVariants

  for (const targetWidth of HOME_MEDIA_VARIANT_SPECS) {
    const output = await sharpFactory(input, SHARP_INPUT_OPTIONS)
      .resize({
        width: targetWidth,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: HOME_MEDIA_WEBP_QUALITY })
      .toBuffer()

    const key = homeMediaVariantKey(originalKey, targetWidth)
    const { publicUrl } = await uploadVariant({
      key,
      body: new Uint8Array(output),
      mimeType: 'image/webp',
      cacheControl: HOME_MEDIA_CACHE_CONTROL,
    })

    variants[`${targetWidth}w`] = publicUrl
  }

  return { variants, width: originalWidth, height: originalHeight }
}

export function hasCanonicalHomeMediaVariants(value: unknown): value is HomeMediaVariants {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const record = value as Record<string, unknown>
  return HOME_MEDIA_VARIANT_SPECS.every((width) => {
    const url = record[`${width}w`]
    return typeof url === 'string' && url.length > 0
  })
}
