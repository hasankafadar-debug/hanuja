/**
 * Cloudflare R2 client — S3-compatible presigned URL generation.
 *
 * Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner (S3-compatible API).
 * File paths are generated server-side — never trust uploaded filenames.
 *
 * Authorization for upload/download access is enforced at the route level.
 */
import { S3Client, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? ''
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? ''
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? ''
const BUCKET_NAME = process.env.R2_BUCKET_NAME ?? 'hanuja-media'
const CDN_URL = process.env.R2_CDN_URL ?? `https://${BUCKET_NAME}.${ACCOUNT_ID}.r2.cloudflarestorage.com`

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
})

export type MediaFolder =
  | 'products'
  | 'stores'
  | 'avatars'
  | 'disputes'
  | 'returns'
  | 'blog'

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export interface PresignedUploadResult {
  uploadUrl: string
  key: string
  publicUrl: string
  expiresIn: number
}

/**
 * Generate a presigned PUT URL for direct browser → R2 upload.
 *
 * The key is generated server-side to prevent path traversal.
 * expiresIn: URL is valid for 5 minutes.
 */
export async function generatePresignedUploadUrl(opts: {
  folder: MediaFolder
  mimeType: string
  ownerId: string
}): Promise<PresignedUploadResult> {
  const { folder, mimeType, ownerId } = opts

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Desteklenmeyen dosya türü: ${mimeType}`)
  }

  const ext = mimeType.split('/')[1] ?? 'jpg'
  const key = `${folder}/${ownerId}/${randomUUID()}.${ext}`
  const expiresIn = 300 // 5 minutes

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: mimeType,
  })

  const uploadUrl = await getSignedUrl(r2, command, { expiresIn })
  const publicUrl = `${CDN_URL}/${key}`

  return { uploadUrl, key, publicUrl, expiresIn }
}

/**
 * Delete an object from R2 by key.
 */
export async function deleteObject(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }),
  )
}

/**
 * Check if an object exists in R2.
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }))
    return true
  } catch {
    return false
  }
}

/**
 * Build a CDN public URL from a stored key.
 */
export function buildCdnUrl(key: string): string {
  return `${CDN_URL}/${key}`
}

export { BUCKET_NAME, MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES }
