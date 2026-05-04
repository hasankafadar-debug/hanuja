/**
 * Cloudflare R2 client — S3-compatible presigned URL generation.
 *
 * Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner (S3-compatible API).
 * File paths are generated server-side — never trust uploaded filenames.
 *
 * Authorization for upload/download access is enforced at the route level.
 */
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'

function requireEnv(key: string, fallback: string): string {
  const value = process.env[key]
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${key} is required in production`)
    }
    return fallback
  }
  return value
}

function getR2Config() {
  const accountId = requireEnv('R2_ACCOUNT_ID', 'dev-account')
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID', 'dev-key')
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY', 'dev-secret')
  const bucketName = requireEnv('R2_BUCKET_NAME', 'hanuja-media')
  const cdnUrl =
    process.env.R2_CDN_URL ??
    process.env.R2_PUBLIC_URL ??
    `https://${bucketName}.${accountId}.r2.cloudflarestorage.com`

  return { accountId, accessKeyId, secretAccessKey, bucketName, cdnUrl }
}

function createR2Client() {
  const { accountId, accessKeyId, secretAccessKey } = getR2Config()

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })
}

export type MediaFolder =
  | 'products'
  | 'stores'
  | 'avatars'
  | 'disputes'
  | 'returns'
  | 'blog'
  | 'documents'
  | 'slider'
  | 'promo'
  | 'general'

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export const SLIDER_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
])

// KYC belgeler için genişletilmiş mime type listesi
export const DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export const DOCUMENT_MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB (PDF'ler daha büyük olabilir)

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

  let allowedTypes: Set<string>
  if (folder === 'documents') {
    allowedTypes = DOCUMENT_ALLOWED_MIME_TYPES
  } else if (folder === 'slider') {
    allowedTypes = new Set([...ALLOWED_MIME_TYPES, ...SLIDER_VIDEO_MIME_TYPES])
  } else {
    allowedTypes = ALLOWED_MIME_TYPES
  }

  if (!allowedTypes.has(mimeType)) {
    throw new Error(`Desteklenmeyen dosya türü: ${mimeType}`)
  }

  const maxSize = folder === 'documents' ? DOCUMENT_MAX_SIZE_BYTES : MAX_FILE_SIZE_BYTES
  void maxSize // enforced at route level
  const { bucketName, cdnUrl } = getR2Config()
  const r2 = createR2Client()

  const mimeExt: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  }
  const ext = mimeExt[mimeType] ?? (mimeType.split('/')[1] ?? 'jpg')
  const key = `${folder}/${ownerId}/${randomUUID()}.${ext}`
  const expiresIn = 300 // 5 minutes

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: mimeType,
  })

  const uploadUrl = await getSignedUrl(r2, command, { expiresIn })
  const publicUrl = `${cdnUrl}/${key}`

  return { uploadUrl, key, publicUrl, expiresIn }
}

/**
 * Upload an object directly from the server.
 */
export async function uploadObject(opts: {
  folder: MediaFolder
  mimeType: string
  ownerId: string
  body: Uint8Array
}): Promise<{ key: string; publicUrl: string }> {
  const { folder, mimeType, ownerId, body } = opts

  let allowedTypesUpload: Set<string>
  if (folder === 'documents') {
    allowedTypesUpload = DOCUMENT_ALLOWED_MIME_TYPES
  } else if (folder === 'slider') {
    allowedTypesUpload = new Set([...ALLOWED_MIME_TYPES, ...SLIDER_VIDEO_MIME_TYPES])
  } else {
    allowedTypesUpload = ALLOWED_MIME_TYPES
  }

  if (!allowedTypesUpload.has(mimeType)) {
    throw new Error(`Desteklenmeyen dosya türü: ${mimeType}`)
  }

  const { bucketName, cdnUrl } = getR2Config()
  const r2 = createR2Client()
  const mimeExtUpload: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  }
  const ext = mimeExtUpload[mimeType] ?? (mimeType.split('/')[1] ?? 'jpg')
  const key = `${folder}/${ownerId}/${randomUUID()}.${ext}`

  await r2.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }),
  )

  return {
    key,
    publicUrl: `${cdnUrl}/${key}`,
  }
}

/**
 * Delete an object from R2 by key.
 */
export async function deleteObject(key: string): Promise<void> {
  const { bucketName } = getR2Config()
  const r2 = createR2Client()
  await r2.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  )
}

/**
 * Check if an object exists in R2.
 */
export async function objectExists(key: string): Promise<boolean> {
  const { bucketName } = getR2Config()
  const r2 = createR2Client()
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))
    return true
  } catch {
    return false
  }
}

/**
 * Read an object from R2 and return its bytes plus metadata.
 */
export async function readObject(key: string): Promise<{
  body: Uint8Array
  contentType: string
  sizeBytes: number
}> {
  const { bucketName } = getR2Config()
  const r2 = createR2Client()
  const response = await r2.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  )

  if (!response.Body) {
    throw new Error('Dosya içeriği okunamadı.')
  }

  const streamBody = response.Body as {
    transformToByteArray?: () => Promise<Uint8Array>
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer | string>
  }

  let body: Uint8Array
  if (typeof streamBody.transformToByteArray === 'function') {
    body = await streamBody.transformToByteArray()
  } else if (typeof streamBody[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as AsyncIterable<Uint8Array | Buffer | string>) {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk))
      } else if (chunk instanceof Uint8Array) {
        chunks.push(chunk)
      } else {
        chunks.push(new Uint8Array(chunk))
      }
    }
    body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  } else {
    throw new Error('Dosya içeriği okunamadı.')
  }

  return {
    body,
    contentType: response.ContentType ?? 'application/octet-stream',
    sizeBytes: Number(response.ContentLength ?? body.byteLength),
  }
}

/**
 * Upload a buffer to R2 at an explicit, caller-supplied key.
 * Used by the media-processing job to store WebP variants alongside the original.
 */
export async function uploadBufferWithKey(opts: {
  key: string
  body: Uint8Array
  mimeType: string
}): Promise<{ publicUrl: string }> {
  const { key, body, mimeType } = opts
  const { bucketName, cdnUrl } = getR2Config()
  const r2 = createR2Client()

  await r2.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }),
  )

  return { publicUrl: `${cdnUrl}/${key}` }
}

/**
 * Build a CDN public URL from a stored key.
 */
export function buildCdnUrl(key: string): string {
  return `${getR2Config().cdnUrl}/${key}`
}

export { MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES }
