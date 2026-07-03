import { DomainError } from '../lib/errors'
import { parseImageMetadata } from '../lib/image-meta'
import { uploadObject } from '../lib/r2'

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
const DEFAULT_IMAGE_TIMEOUT_MS = 90_000
const DEFAULT_IMAGE_SIZE = '1536x1024'

export interface SeoGeneratedImageResult {
  assetId: string
  objectKey: string | null
  publicUrl: string
  responseId: string | null
  mimeType: string
  width: number
  height: number
  revisedPrompt: string | null
}

export function createSeoImageService(deps: {
  prisma: import('@prisma/client').PrismaClient
}) {
  const { prisma } = deps

  async function generateCoverImage(input: {
    prompt: string
    ownerId: string
  }): Promise<SeoGeneratedImageResult> {
    const apiKey = process.env['OPENAI_API_KEY']?.trim()
    if (!apiKey) {
      throw new DomainError(
        'SEO gorsel uretimi icin OPENAI_API_KEY gerekli.',
        'OPENAI_CONFIG_MISSING',
        503,
      )
    }

    const model = process.env['OPENAI_SEO_IMAGE_MODEL']?.trim() || DEFAULT_IMAGE_MODEL
    const timeoutMs = getNumberEnv('OPENAI_SEO_IMAGE_TIMEOUT_MS', DEFAULT_IMAGE_TIMEOUT_MS)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(OPENAI_IMAGE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          prompt: sanitizeImagePrompt(input.prompt),
          n: 1,
          size: DEFAULT_IMAGE_SIZE,
          quality: 'medium',
          output_format: 'png',
          moderation: 'auto',
        }),
      })

      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
      if (!response.ok) {
        throw buildImageError(response.status, payload)
      }

      const data = Array.isArray(payload?.['data']) ? payload?.['data'] : []
      const image = data[0]
      if (!image || typeof image !== 'object') {
        throw new DomainError(
          'OpenAI gorsel yaniti bos dondu.',
          'OPENAI_IMAGE_EMPTY',
          502,
        )
      }

      const b64 = typeof (image as { b64_json?: unknown }).b64_json === 'string'
        ? ((image as { b64_json: string }).b64_json)
        : null
      if (!b64) {
        throw new DomainError(
          'OpenAI gorseli base64 formatinda donmedi.',
          'OPENAI_IMAGE_INVALID',
          502,
        )
      }

      const bytes = Uint8Array.from(Buffer.from(b64, 'base64'))
      const meta = parseImageMetadata(bytes, 'image/png')
      if (meta.width !== 1536 || meta.height !== 1024) {
        throw new DomainError(
          `OpenAI gorseli beklenen boyutta degil: ${meta.width}x${meta.height}`,
          'OPENAI_IMAGE_DIMENSION_INVALID',
          502,
        )
      }

      const uploaded = await uploadObject({
        folder: 'blog',
        mimeType: 'image/png',
        ownerId: input.ownerId,
        body: bytes,
      })

      const asset = await prisma.mediaAsset.create({
        data: {
          uploadedBy: input.ownerId,
          folder: 'blog',
          key: uploaded.key,
          url: uploaded.publicUrl,
          mimeType: 'image/png',
          status: 'ready',
          type: 'blog_image',
          kind: 'image',
          width: meta.width,
          height: meta.height,
          sizeBytes: bytes.byteLength,
          originalName: 'openai-seo-cover.png',
        },
        select: { id: true },
      })

      return {
        assetId: asset.id,
        objectKey: uploaded.key,
        publicUrl: uploaded.publicUrl,
        responseId: typeof payload?.['id'] === 'string' ? payload['id'] : null,
        mimeType: 'image/png',
        width: meta.width,
        height: meta.height,
        revisedPrompt:
          typeof (image as { revised_prompt?: unknown }).revised_prompt === 'string'
            ? ((image as { revised_prompt: string }).revised_prompt)
            : null,
      }
    } catch (error) {
      if (error instanceof DomainError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DomainError(
          'OpenAI gorsel istegi zaman asimina ugradi.',
          'OPENAI_IMAGE_TIMEOUT',
          504,
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  return { generateCoverImage }
}

function sanitizeImagePrompt(value: string): string {
  return value
    .replace(/\blogo\b/giu, 'markasiz')
    .replace(/\bwatermark\b/giu, 'temiz kompozisyon')
    .replace(/\btext\b/giu, 'yazisiz')
    .trim()
}

function buildImageError(status: number, payload: Record<string, unknown> | null) {
  const message = extractApiErrorMessage(payload) || `OpenAI gorsel istegi basarisiz oldu (${status}).`

  if (status === 408 || status === 429) {
    return new DomainError(
      message,
      status === 429 ? 'OPENAI_IMAGE_RATE_LIMIT' : 'OPENAI_IMAGE_TIMEOUT',
      status,
    )
  }

  if (status >= 500) {
    return new DomainError(message, 'OPENAI_IMAGE_UPSTREAM_ERROR', 502)
  }

  return new DomainError(message, 'OPENAI_IMAGE_REQUEST_FAILED', 502)
}

function getNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function extractApiErrorMessage(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const errorValue = payload['error']
  if (!errorValue || typeof errorValue !== 'object') return null
  const message = (errorValue as Record<string, unknown>)['message']
  return typeof message === 'string' && message.trim() ? message : null
}
