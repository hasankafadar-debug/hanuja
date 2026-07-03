/**
 * Cloudflare R2 client - S3-compatible presigned URL generation.
 *
 * Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner (S3-compatible API).
 * File paths are generated server-side - never trust uploaded filenames.
 *
 * Authorization for upload/download access is enforced at the route level.
 */
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import { DomainError } from './errors'

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new DomainError(
      `Medya servisi yapilandirilmamis. Eksik ortam degiskeni: ${key}`,
      'MEDIA_CONFIG_MISSING',
      503,
    )
  }
  return value
}

function maskAccountId(accountId: string) {
  if (accountId.length <= 8) return '***'
  return `${accountId.slice(0, 4)}...${accountId.slice(-4)}`
}

function getR2Config() {
  const accountId = requireEnv('R2_ACCOUNT_ID')
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY')
  const bucketName = requireEnv('R2_BUCKET_NAME')
  const endpointHost = `${accountId}.r2.cloudflarestorage.com`
  const endpoint = `https://${endpointHost}`
  const cdnUrl =
    process.env.R2_CDN_URL ??
    process.env.R2_PUBLIC_URL ??
    `https://${bucketName}.${endpointHost}`

  return { accountId, accessKeyId, secretAccessKey, bucketName, endpoint, endpointHost, cdnUrl }
}

export function getSanitizedR2DebugContext() {
  const { accountId, bucketName, endpointHost, cdnUrl } = getR2Config()
  return {
    accountId: maskAccountId(accountId),
    bucketName,
    endpointHost,
    cdnHost: (() => {
      try {
        return new URL(cdnUrl).host
      } catch {
        return 'invalid-cdn-url'
      }
    })(),
  }
}

function createR2Client() {
  const { endpoint, accessKeyId, secretAccessKey } = getR2Config()

  return new S3Client({
    region: 'auto',
    endpoint,
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
  | 'customer-support'

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

// Extended mime type list for KYC documents.
export const DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export const DOCUMENT_MAX_SIZE_BYTES = 20 * 1024 * 1024

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const BUCKET_ACCESS_ERROR_MESSAGE = 'R2 bucket bulunamadi veya bu account altinda erisilemiyor.'
let bucketValidationPromise: Promise<void> | null = null

export interface PresignedUploadResult {
  uploadUrl: string
  key: string
  publicUrl: string
  expiresIn: number
}

function getBucketAccessStatusCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return null

  if ('$metadata' in error) {
    const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    if (typeof metadata?.httpStatusCode === 'number') return metadata.httpStatusCode
  }

  if ('statusCode' in error && typeof (error as { statusCode?: number }).statusCode === 'number') {
    return (error as { statusCode: number }).statusCode
  }

  if ('Code' in error) {
    const code = String((error as { Code?: unknown }).Code ?? '')
    if (code === 'NoSuchBucket' || code === 'NotFound') return 404
    if (code === 'AccessDenied' || code === 'Forbidden') return 403
  }

  return null
}

async function validateBucketAccess(folder: MediaFolder) {
  if (!bucketValidationPromise) {
    const context = getSanitizedR2DebugContext()
    console.info('[r2][config-check]', {
      ...context,
      folder,
    })

    bucketValidationPromise = (async () => {
      const { bucketName } = getR2Config()
      const r2 = createR2Client()

      try {
        await r2.send(new HeadBucketCommand({ Bucket: bucketName }))
      } catch (error) {
        const statusCode = getBucketAccessStatusCode(error)
        console.error('[r2][bucket-access-failed]', {
          ...context,
          statusCode,
          error: error instanceof Error ? error.message : error,
        })

        if (statusCode === 403 || statusCode === 404) {
          throw new DomainError(BUCKET_ACCESS_ERROR_MESSAGE, 'MEDIA_BUCKET_UNREACHABLE', 503)
        }

        throw error
      }
    })().catch((error) => {
      bucketValidationPromise = null
      throw error
    })
  }

  await bucketValidationPromise
}

/**
 * Generate a presigned PUT URL for direct browser -> R2 upload.
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
  if (folder === 'documents' || folder === 'customer-support') {
    allowedTypes = DOCUMENT_ALLOWED_MIME_TYPES
  } else if (folder === 'slider') {
    allowedTypes = new Set([...ALLOWED_MIME_TYPES, ...SLIDER_VIDEO_MIME_TYPES])
  } else {
    allowedTypes = ALLOWED_MIME_TYPES
  }

  if (!allowedTypes.has(mimeType)) {
    throw new DomainError(
      `Bu dosya turu bu alan icin desteklenmiyor: ${mimeType}`,
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    )
  }

  const maxSize =
    folder === 'documents' || folder === 'customer-support'
      ? DOCUMENT_MAX_SIZE_BYTES
      : MAX_FILE_SIZE_BYTES
  void maxSize

  await validateBucketAccess(folder)

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
  const expiresIn = 300

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
    throw new DomainError(
      `Bu dosya turu bu alan icin desteklenmiyor: ${mimeType}`,
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    )
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
    throw new Error('Dosya icerigi okunamadi.')
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
    throw new Error('Dosya icerigi okunamadi.')
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
