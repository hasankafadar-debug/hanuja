import { DomainError } from '../lib/errors'
import {
  SEO_OPENAI_PROMPT_VERSION,
  SEO_OPENAI_SCHEMA_VERSION,
  buildSeoPromptEnvelope,
  seoStructuredArticleSchema,
  type SeoFactPack,
  type SeoStructuredArticle,
} from '../domain/seo-generated-content'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_TEXT_MODEL = 'gpt-5.5'
const DEFAULT_TEXT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT_TOKENS = 6_000

export interface SeoOpenAiGenerationResult {
  article: SeoStructuredArticle
  responseId: string | null
  promptVersion: string
  schemaVersion: string
  promptHash: string
  tokenUsage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedTokens: number
  }
}

export function createSeoOpenAiService() {
  async function generateStructuredArticle(
    factPack: SeoFactPack,
  ): Promise<SeoOpenAiGenerationResult> {
    const apiKey = process.env['OPENAI_API_KEY']?.trim()
    if (!apiKey) {
      throw new DomainError(
        'SEO OpenAI entegrasyonu icin OPENAI_API_KEY gerekli.',
        'OPENAI_CONFIG_MISSING',
        503,
      )
    }

    const model = process.env['OPENAI_SEO_TEXT_MODEL']?.trim() || DEFAULT_TEXT_MODEL
    const maxOutputTokens = getNumberEnv(
      'SEO_CONTENT_OPENAI_MAX_OUTPUT_TOKENS',
      DEFAULT_MAX_OUTPUT_TOKENS,
    )
    const timeoutMs = getNumberEnv('OPENAI_SEO_TEXT_TIMEOUT_MS', DEFAULT_TEXT_TIMEOUT_MS)
    const prompt = buildSeoPromptEnvelope(factPack)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          store: false,
          instructions: prompt.instructions,
          input: prompt.input,
          max_output_tokens: maxOutputTokens,
          text: {
            format: {
              type: 'json_schema',
              name: 'hanuja_seo_article',
              strict: true,
              schema: buildStructuredOutputJsonSchema(),
            },
          },
        }),
      })

      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null

      if (!response.ok) {
        throw buildOpenAiError(response.status, payload)
      }

      const outputText = extractResponseOutputText(payload)
      if (!outputText) {
        throw new DomainError(
          'OpenAI SEO yaniti metin dondurmedi.',
          'OPENAI_EMPTY_RESPONSE',
          502,
        )
      }

      const parsedJson = JSON.parse(outputText)
      const article = seoStructuredArticleSchema.parse(parsedJson)
      const usage = parseUsage(payload)

      return {
        article,
        responseId: typeof payload?.['id'] === 'string' ? payload['id'] : null,
        promptVersion: SEO_OPENAI_PROMPT_VERSION,
        schemaVersion: SEO_OPENAI_SCHEMA_VERSION,
        promptHash: prompt.promptHash,
        tokenUsage: usage,
      }
    } catch (error) {
      if (error instanceof DomainError) throw error
      if (error instanceof SyntaxError) {
        throw new DomainError(
          'OpenAI SEO yaniti gecerli JSON degil.',
          'OPENAI_INVALID_JSON',
          502,
        )
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DomainError(
          'OpenAI SEO istegi zaman asimina ugradi.',
          'OPENAI_TIMEOUT',
          504,
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  return { generateStructuredArticle }
}

export function isTransientOpenAiError(error: unknown): boolean {
  if (!(error instanceof DomainError)) return false
  return ['OPENAI_TIMEOUT', 'OPENAI_RATE_LIMIT', 'OPENAI_UPSTREAM_ERROR'].includes(error.code)
}

function buildStructuredOutputJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'title',
      'summary',
      'metaDescription',
      'imagePrompt',
      'sections',
      'internalLinks',
      'productMentions',
    ],
    properties: {
      title: { type: 'string', minLength: 12, maxLength: 110 },
      summary: { type: 'string', minLength: 90, maxLength: 260 },
      metaDescription: { type: 'string', minLength: 90, maxLength: 170 },
      imagePrompt: { type: 'string', minLength: 20, maxLength: 800 },
      sections: {
        type: 'array',
        minItems: 3,
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['heading', 'paragraphs', 'sourceFactIds'],
          properties: {
            heading: { type: 'string', minLength: 3, maxLength: 90 },
            paragraphs: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: { type: 'string', minLength: 20, maxLength: 600 },
            },
            sourceFactIds: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: { type: 'string', minLength: 1, maxLength: 120 },
            },
          },
        },
      },
      internalLinks: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'href', 'label', 'type', 'refId', 'sourceFactIds'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 120 },
            href: { type: 'string', minLength: 1, maxLength: 300 },
            label: { type: 'string', minLength: 2, maxLength: 80 },
            type: { type: 'string', enum: ['category', 'product'] },
            refId: { type: 'string', minLength: 1, maxLength: 120 },
            sourceFactIds: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: { type: 'string', minLength: 1, maxLength: 120 },
            },
          },
        },
      },
      productMentions: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['productId', 'title', 'reason', 'sourceFactIds'],
          properties: {
            productId: { type: 'string', minLength: 1, maxLength: 120 },
            title: { type: 'string', minLength: 2, maxLength: 120 },
            reason: { type: 'string', minLength: 20, maxLength: 280 },
            sourceFactIds: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: { type: 'string', minLength: 1, maxLength: 120 },
            },
          },
        },
      },
    },
  }
}

function extractResponseOutputText(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const output = Array.isArray(payload['output']) ? payload['output'] : []
  const parts: string[] = []

  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? ((item as { content: unknown[] }).content)
      : []

    for (const chunk of content) {
      if (!chunk || typeof chunk !== 'object') continue
      const text = (chunk as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }

  if (parts.length === 0 && typeof payload['output_text'] === 'string') {
    return payload['output_text']
  }

  return parts.length > 0 ? parts.join('\n').trim() : null
}

function parseUsage(payload: Record<string, unknown> | null) {
  const usage = payload?.['usage']
  if (!usage || typeof usage !== 'object') {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
    }
  }

  const usageRecord = usage as Record<string, unknown>
  const inputTokens = toNumber(usageRecord['input_tokens'])
  const outputTokens = toNumber(usageRecord['output_tokens'])
  const totalTokens = toNumber(usageRecord['total_tokens']) || inputTokens + outputTokens
  const inputDetails =
    usageRecord['input_tokens_details'] &&
    typeof usageRecord['input_tokens_details'] === 'object'
      ? (usageRecord['input_tokens_details'] as Record<string, unknown>)
      : null

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens: inputDetails ? toNumber(inputDetails['cached_tokens']) : 0,
  }
}

function buildOpenAiError(status: number, payload: Record<string, unknown> | null) {
  const message = extractApiErrorMessage(payload) || `OpenAI istegi basarisiz oldu (${status}).`

  if (status === 408 || status === 429) {
    return new DomainError(message, status === 429 ? 'OPENAI_RATE_LIMIT' : 'OPENAI_TIMEOUT', status)
  }

  if (status >= 500) {
    return new DomainError(message, 'OPENAI_UPSTREAM_ERROR', 502)
  }

  return new DomainError(message, 'OPENAI_REQUEST_FAILED', 502)
}

function getNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function extractApiErrorMessage(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const errorValue = payload['error']
  if (!errorValue || typeof errorValue !== 'object') return null
  const message = (errorValue as Record<string, unknown>)['message']
  return typeof message === 'string' && message.trim() ? message : null
}
