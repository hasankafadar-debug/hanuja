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
    process.env.R2_CDN_URL ?? process.env.R2_PUBLIC_URL ?? `https://${bucketName}.${endpointHost}`

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

export function createR2Client(purpose: 'server' | 'browser-presign' = 'server') {
  const { endpoint, accessKeyId, secretAccessKey } = getR2Config()

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // AWS SDK >=3.729 adds CRC32 by default; R2 browser presigns must only add required checksums.
    ...(purpose === 'browser-presign'
      ? { requestChecksumCalculation: 'WHEN_REQUIRED' as const }
      : {}),
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

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export const SLIDER_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm'])

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
const SIZE_LIMIT_ERROR_CODE = 'MEDIA_FILE_TOO_LARGE'
const BUCKET_ACCESS_ERROR_MESSAGE = 'R2 bucket bulunamadi veya bu account altinda erisilemiyor.'
let bucketValidationPromise: Promise<void> | null = null

export interface PresignedUploadResult {
  uploadUrl: string
  key: string
  publicUrl: string
  expiresIn: number
}

/** The server verifies this limit after browser-direct uploads and before processing. */
export function getMediaMaxSizeBytes(folder: MediaFolder): number {
  return folder === 'documents' || folder === 'customer-support'
    ? DOCUMENT_MAX_SIZE_BYTES
    : MAX_FILE_SIZE_BYTES
}

export function getAllowedMediaMimeTypes(folder: MediaFolder): Set<string> {
  if (folder === 'documents' || folder === 'customer-support') {
    return DOCUMENT_ALLOWED_MIME_TYPES
  }

  if (folder === 'slider') {
    return new Set([...ALLOWED_MIME_TYPES, ...SLIDER_VIDEO_MIME_TYPES])
  }

  return ALLOWED_MIME_TYPES
}

function mediaSizeLimitError(maxBytes: number) {
  return new DomainError(
    `Dosya boyutu en fazla ${Math.round(maxBytes / 1024 / 1024)} MB olabilir.`,
    SIZE_LIMIT_ERROR_CODE,
    413,
  )
}

export async function presignR2PutObjectUrl(opts: {
  client: S3Client
  bucketName: string
  key: string
  mimeType: string
  expiresIn: number
}): Promise<string> {
  const { client, bucketName, key, mimeType, expiresIn } = opts
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: mimeType,
  })

  return getSignedUrl(client, command, {
    expiresIn,
    signableHeaders: new Set(['content-type']),
  })
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

  const allowedTypes = getAllowedMediaMimeTypes(folder)

  if (!allowedTypes.has(mimeType)) {
    throw new DomainError(
      `Bu dosya turu bu alan icin desteklenmiyor: ${mimeType}`,
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    )
  }

  await validateBucketAccess(folder)

  const { bucketName, cdnUrl } = getR2Config()
  const r2 = createR2Client('browser-presign')

  const mimeExt: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  }
  const ext = mimeExt[mimeType] ?? mimeType.split('/')[1] ?? 'jpg'
  const key = `${folder}/${ownerId}/${randomUUID()}.${ext}`
  const expiresIn = 300

  const uploadUrl = await presignR2PutObjectUrl({
    client: r2,
    bucketName,
    key,
    mimeType,
    expiresIn,
  })
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

  const allowedTypesUpload = getAllowedMediaMimeTypes(folder)

  if (!allowedTypesUpload.has(mimeType)) {
    throw new DomainError(
      `Bu dosya turu bu alan icin desteklenmiyor: ${mimeType}`,
      'UNSUPPORTED_MEDIA_TYPE',
      415,
    )
  }

  if (body.byteLength > getMediaMaxSizeBytes(folder)) {
    throw mediaSizeLimitError(getMediaMaxSizeBytes(folder))
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
  const ext = mimeExtUpload[mimeType] ?? mimeType.split('/')[1] ?? 'jpg'
  const key = `${folder}/${ownerId}/${randomUUID()}.${ext}`

  await r2.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: mimeType,
      ContentLength: body.byteLength,
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

export interface R2ObjectMetadata {
  contentLength: number | null
  contentType: string | null
}

/** Read only object metadata; callers must not infer limits from client claims. */
export async function getObjectMetadata(key: string): Promise<R2ObjectMetadata> {
  const { bucketName } = getR2Config()
  const r2 = createR2Client()
  const response = await r2.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }))

  return {
    contentLength:
      typeof response.ContentLength === 'number' && Number.isFinite(response.ContentLength)
        ? response.ContentLength
        : null,
    contentType: response.ContentType ?? null,
  }
}

/**
 * Check if an object exists in R2.
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await getObjectMetadata(key)
    return true
  } catch {
    return false
  }
}

type StreamChunk = Uint8Array | Buffer | string

type ReadableObjectBody = {
  [Symbol.asyncIterator]?: () => AsyncIterator<StreamChunk>
  getReader?: () => ReadableStreamDefaultReader<Uint8Array>
  cancel?: (reason?: unknown) => Promise<void> | void
  destroy?: (error?: Error) => void
}

function toUint8Array(chunk: StreamChunk): Uint8Array {
  if (typeof chunk === 'string') return Buffer.from(chunk)
  if (chunk instanceof Uint8Array) return chunk
  return new Uint8Array(chunk)
}

async function discardObjectBody(body: ReadableObjectBody, reason: Error) {
  try {
    if (typeof body.destroy === 'function') {
      body.destroy(reason)
      return
    }
    if (typeof body.cancel === 'function') await body.cancel(reason)
  } catch {
    // The size validation result is still authoritative even if stream cleanup fails.
  }
}

async function readObjectBodyWithinLimit(
  body: ReadableObjectBody,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  const append = (chunk: StreamChunk) => {
    const bytes = toUint8Array(chunk)
    totalBytes += bytes.byteLength
    if (totalBytes > maxBytes) {
      throw mediaSizeLimitError(maxBytes)
    }
    chunks.push(bytes)
  }

  if (typeof body[Symbol.asyncIterator] === 'function') {
    try {
      for await (const chunk of body as AsyncIterable<StreamChunk>) {
        append(chunk)
      }
    } catch (error) {
      if (error instanceof Error) await discardObjectBody(body, error)
      throw error
    }
  } else if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        try {
          append(value)
        } catch (error) {
          if (error instanceof Error) await reader.cancel(error)
          throw error
        }
      }
    } finally {
      reader.releaseLock()
    }
  } else {
    throw new Error('Dosya icerigi okunamadi.')
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

/**
 * Read an object from R2 and return its bytes plus metadata.
 */
export async function readObject(
  key: string,
  maxBytes = MAX_FILE_SIZE_BYTES,
): Promise<{
  body: Uint8Array
  contentType: string
  sizeBytes: number
}> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Gecersiz medya boyut siniri.')
  }

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

  const streamBody = response.Body as ReadableObjectBody
  const contentLength = response.ContentLength
  if (typeof contentLength === 'number' && contentLength > maxBytes) {
    const error = mediaSizeLimitError(maxBytes)
    await discardObjectBody(streamBody, error)
    throw error
  }

  const body = await readObjectBodyWithinLimit(streamBody, maxBytes)

  return {
    body,
    contentType: response.ContentType ?? 'application/octet-stream',
    sizeBytes: body.byteLength,
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
      ContentLength: body.byteLength,
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
