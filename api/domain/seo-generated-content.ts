import crypto from 'node:crypto'
import { z } from 'zod'
import {
  normalizeSeoText,
  type SearchDemandSignal,
  type SeoProductSignal,
  type SeoTopicCandidate,
} from './seo-topic-cluster'

export const SEO_OPENAI_PROMPT_VERSION = 'seo-openai-tr-v1'
export const SEO_OPENAI_SCHEMA_VERSION = 'seo-structured-article-v1'

export const seoStructuredArticleSchema = z.object({
  title: z.string().trim().min(12).max(110),
  summary: z.string().trim().min(90).max(260),
  metaDescription: z.string().trim().min(90).max(170),
  imagePrompt: z.string().trim().min(20).max(800),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(3).max(90),
        paragraphs: z.array(z.string().trim().min(20).max(600)).min(1).max(4),
        sourceFactIds: z.array(z.string().trim().min(1)).min(1).max(8),
      }),
    )
    .min(3)
    .max(8),
  internalLinks: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120),
        href: z.string().trim().min(1).max(300),
        label: z.string().trim().min(2).max(80),
        type: z.enum(['category', 'product']),
        refId: z.string().trim().min(1).max(120),
        sourceFactIds: z.array(z.string().trim().min(1)).min(1).max(8),
      }),
    )
    .min(1)
    .max(6),
  productMentions: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(120),
        title: z.string().trim().min(2).max(120),
        reason: z.string().trim().min(20).max(280),
        sourceFactIds: z.array(z.string().trim().min(1)).min(1).max(8),
      }),
    )
    .min(1)
    .max(3),
})

export type SeoStructuredArticle = z.infer<typeof seoStructuredArticleSchema>

export interface SeoFactRecord {
  id: string
  type: 'category' | 'product' | 'signal' | 'rule'
  label: string
  value: string
}

export interface SeoFactPackProduct {
  id: string
  slug: string
  name: string
  price: number | null
  stockQuantity: number
  descriptionSnippet: string | null
  imageUrl: string | null
  factId: string
}

export interface SeoFactPackLink {
  id: string
  href: string
  label: string
  type: 'category' | 'product'
  refId: string
  sourceFactIds: string[]
}

export interface SeoFactPack {
  candidate: {
    clusterKey: string
    rootTopic: string
    subIntent: string
    intentType: string
    targetKeyword: string
    supportingKeywords: string[]
  }
  category: {
    id: string
    slug: string
    name: string
    factId: string
  }
  products: SeoFactPackProduct[]
  demandSignals: Array<{
    query: string
    source: SearchDemandSignal['source']
    impressions?: number
    clicks?: number
    count?: number
    position?: number
    factId: string
  }>
  allowedInternalLinks: SeoFactPackLink[]
  facts: SeoFactRecord[]
}

export interface SeoPromptEnvelope {
  instructions: string
  input: string
  promptHash: string
}

export interface SeoArticleValidationResult {
  decision: 'pass' | 'draft_only' | 'reject'
  reasons: string[]
  normalizedTitle: string
  normalizedKeyword: string
  headingSet: string[]
  bodyText: string
}

export interface RenderedSeoArticle {
  body: string
  linkedCategoryIds: string[]
  linkedProductIds: string[]
  headingSet: string[]
  bodyText: string
}

const GENERIC_FILLER_PHRASES = [
  'sizler icin',
  'mekana deger katar',
  'en iyi seceneklerden biri',
  'gunumuzde',
  'hayatinizi kolaylastirir',
]

const DISALLOWED_CLAIM_PATTERNS = [
  /\b\d+[.,]?\d*\s*(tl|₺|lira)\b/iu,
  /\b%\s*\d+/u,
  /\bstokta\b/iu,
  /\bstok\b/iu,
  /\bteslimat\b/iu,
  /\bkargo\b/iu,
  /\bucretsiz\b/iu,
  /\bindirim\b/iu,
  /\bkampanya\b/iu,
  /https?:\/\//iu,
  /\bwww\./iu,
]

const SECTION_LIMIT = 8

export function buildSeoFactPack(input: {
  candidate: SeoTopicCandidate
  products: SeoProductSignal[]
  demandSignals: SearchDemandSignal[]
}): SeoFactPack {
  const { candidate } = input
  const categoryFactId = `category:${candidate.category.id}`
  const facts: SeoFactRecord[] = [
    {
      id: categoryFactId,
      type: 'category',
      label: 'Kategori',
      value: `${candidate.category.name} (/kategori/${candidate.category.slug})`,
    },
    {
      id: `rule:no_price`,
      type: 'rule',
      label: 'Fiyat ve stok yazma',
      value:
        'Yazida kesin fiyat, stok adedi, teslimat suresi, indirim veya kampanya iddiasi yazma.',
    },
  ]

  const categoryProducts = input.products
    .filter((product) => candidate.linkedCategoryIds.includes(product.categoryId ?? ''))
    .sort((left, right) => {
      const leftHit = candidate.linkedProductIds.includes(left.id) ? 1 : 0
      const rightHit = candidate.linkedProductIds.includes(right.id) ? 1 : 0
      return rightHit - leftHit
    })

  const selectedProducts = categoryProducts
    .filter((product) => product.stockQuantity > 0)
    .slice(0, 6)
    .map<SeoFactPackProduct>((product, index) => {
      const factId = `product:${product.id}:${index + 1}`
      facts.push({
        id: factId,
        type: 'product',
        label: product.name,
        value: [
          `slug=${product.slug}`,
          product.price != null ? `price=${product.price}` : null,
          `stock=${product.stockQuantity}`,
          product.description ? `description=${truncateText(normalizeWhitespace(product.description), 220)}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
      })

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        price: product.price ?? null,
        stockQuantity: product.stockQuantity ?? 0,
        descriptionSnippet: product.description
          ? truncateText(normalizeWhitespace(product.description), 220)
          : null,
        imageUrl: product.imageUrl ?? null,
        factId,
      }
    })

  const demandSignals = input.demandSignals
    .filter((signal) => {
      const query = normalizeSeoText(signal.query)
      return (
        query.includes(candidate.targetKeyword) ||
        candidate.targetKeyword.includes(query) ||
        query.includes(candidate.category.slug.replace(/-/g, ' '))
      )
    })
    .slice(0, 6)
    .map((signal, index) => {
      const factId = `signal:${index + 1}`
      facts.push({
        id: factId,
        type: 'signal',
        label: signal.query,
        value: JSON.stringify({
          source: signal.source,
          count: signal.count ?? null,
          impressions: signal.impressions ?? null,
          clicks: signal.clicks ?? null,
          position: signal.position ?? null,
        }),
      })
      return { ...signal, factId }
    })

  const allowedInternalLinks: SeoFactPackLink[] = [
    {
      id: `link:category:${candidate.category.id}`,
      href: `/kategori/${candidate.category.slug}`,
      label: candidate.category.name,
      type: 'category',
      refId: candidate.category.id,
      sourceFactIds: [categoryFactId],
    },
    ...selectedProducts.slice(0, 3).map((product) => ({
      id: `link:product:${product.id}`,
      href: `/urun/${product.slug}`,
      label: product.name,
      type: 'product' as const,
      refId: product.id,
      sourceFactIds: [product.factId],
    })),
  ]

  return {
    candidate: {
      clusterKey: candidate.clusterKey,
      rootTopic: candidate.rootTopic,
      subIntent: candidate.subIntent,
      intentType: candidate.intentType,
      targetKeyword: candidate.targetKeyword,
      supportingKeywords: candidate.supportingKeywords,
    },
    category: {
      id: candidate.category.id,
      slug: candidate.category.slug,
      name: candidate.category.name,
      factId: categoryFactId,
    },
    products: selectedProducts,
    demandSignals,
    allowedInternalLinks,
    facts,
  }
}

export function buildSeoPromptEnvelope(factPack: SeoFactPack): SeoPromptEnvelope {
  const instructions = [
    'Sen Hanuja icin Turkce SEO rehberleri yazan bir icerik editorusun.',
    'Sadece verilen fact pack icindeki dogrulanmis bilgilerden yararlan.',
    'Fact pack disinda fiyat, stok, teslimat, kampanya, indirim, malzeme veya urun iddiasi uydurma.',
    'Kesin fiyat yazma. Stok adedi yazma. Kargo ve teslimat vaadi yazma.',
    'Yazi blog yazisi olarak kategori otoritesi kurmali; kategori veya urun sayfalariyla ticari olarak yarisma.',
    'Paragraflarda markdown, HTML, URL veya liste karakterleri yazma; yalnizca duz metin don.',
    'internalLinks yalnizca allowedInternalLinks listesinden secilmeli.',
    'productMentions yalnizca fact pack icindeki gercek productId degerlerini kullanmali.',
    'Her section, internal link ve product mention en az bir sourceFactIds degeri tasimali.',
    'imagePrompt kapak gorseli icin olusturulmali; gorselde yazi, logo, watermark, fiyat etiketi veya marka vaadi isteme.',
  ].join('\n')

  const input = JSON.stringify(
    {
      brief: {
        targetKeyword: factPack.candidate.targetKeyword,
        rootTopic: factPack.candidate.rootTopic,
        subIntent: factPack.candidate.subIntent,
        intentType: factPack.candidate.intentType,
        supportingKeywords: factPack.candidate.supportingKeywords,
      },
      category: factPack.category,
      products: factPack.products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        stockQuantity: product.stockQuantity,
        descriptionSnippet: product.descriptionSnippet,
        factId: product.factId,
      })),
      demandSignals: factPack.demandSignals.map((signal) => ({
        query: signal.query,
        source: signal.source,
        count: signal.count ?? null,
        impressions: signal.impressions ?? null,
        clicks: signal.clicks ?? null,
        position: signal.position ?? null,
        factId: signal.factId,
      })),
      allowedInternalLinks: factPack.allowedInternalLinks,
      facts: factPack.facts,
      outputRules: {
        language: 'tr-TR',
        tone: 'yardimci, net, urun verisine sadik',
        sectionCount: `3-${SECTION_LIMIT}`,
      },
    },
    null,
    2,
  )

  return {
    instructions,
    input,
    promptHash: sha256(`${SEO_OPENAI_PROMPT_VERSION}\n${instructions}\n${input}`),
  }
}

export function validateGeneratedSeoArticle(
  article: SeoStructuredArticle,
  factPack: SeoFactPack,
): SeoArticleValidationResult {
  const reasons: string[] = []
  const factIds = new Set(factPack.facts.map((fact) => fact.id))
  const allowedLinks = new Map(factPack.allowedInternalLinks.map((link) => [link.id, link]))
  const productMap = new Map(factPack.products.map((product) => [product.id, product]))
  const normalizedKeyword = normalizeSeoText(factPack.candidate.targetKeyword)
  const normalizedTitle = normalizeSeoText(article.title)
  const headingSet: string[] = []
  const paragraphCorpus: string[] = [article.summary, article.metaDescription]

  if (normalizedTitle === normalizeSeoText(factPack.category.name)) {
    reasons.push('title_cannibalizes_category')
  }

  for (const phrase of GENERIC_FILLER_PHRASES) {
    if (normalizeSeoText(article.summary).includes(phrase)) {
      reasons.push('generic_ai_summary')
      break
    }
  }

  const seenHeadings = new Set<string>()
  for (const section of article.sections) {
    const normalizedHeading = normalizeSeoText(section.heading)
    headingSet.push(normalizedHeading)
    if (seenHeadings.has(normalizedHeading)) reasons.push('duplicate_heading')
    seenHeadings.add(normalizedHeading)
    if (!hasOnlyKnownFactIds(section.sourceFactIds, factIds)) reasons.push('unknown_section_fact_id')
    paragraphCorpus.push(...section.paragraphs)
  }

  let categoryLinkCount = 0
  let productLinkCount = 0

  for (const link of article.internalLinks) {
    const allowed = allowedLinks.get(link.id)
    if (!allowed) {
      reasons.push('link_not_allowlisted')
      continue
    }

        if (
          allowed.href !== link.href ||
          allowed.type !== link.type ||
          allowed.refId !== link.refId
        ) {
          reasons.push('link_payload_mismatch')
        }

    if (!hasOnlyKnownFactIds(link.sourceFactIds, factIds)) {
      reasons.push('unknown_link_fact_id')
    }

    if (link.type === 'category') categoryLinkCount += 1
    if (link.type === 'product') productLinkCount += 1
  }

  if (categoryLinkCount < 1) reasons.push('missing_category_link')
  if (productLinkCount < 1 || productLinkCount > 3) reasons.push('invalid_product_link_count')

  for (const mention of article.productMentions) {
    if (!productMap.has(mention.productId)) reasons.push('unknown_product_mention')
    if (!hasOnlyKnownFactIds(mention.sourceFactIds, factIds)) reasons.push('unknown_product_fact_id')
    paragraphCorpus.push(mention.reason)
  }

  const bodyText = normalizeWhitespace(paragraphCorpus.join(' '))
  const normalizedBody = normalizeSeoText(bodyText)
  const keywordCount = countOccurrences(normalizedBody, normalizedKeyword)
  if (keywordCount > 8) reasons.push('keyword_stuffing_risk')

  for (const pattern of DISALLOWED_CLAIM_PATTERNS) {
    if (pattern.test(bodyText)) {
      reasons.push('unsupported_claim_pattern')
      break
    }
  }

  if (normalizeSeoText(article.metaDescription).includes('http')) {
    reasons.push('meta_contains_external_url')
  }

  const uniqueReasons = [...new Set(reasons)]
  return {
    decision: uniqueReasons.length > 0 ? 'reject' : 'pass',
    reasons: uniqueReasons,
    normalizedTitle,
    normalizedKeyword,
    headingSet,
    bodyText,
  }
}

export function renderGeneratedSeoArticle(
  article: SeoStructuredArticle,
  factPack: SeoFactPack,
): RenderedSeoArticle {
  const linksById = new Map(factPack.allowedInternalLinks.map((link) => [link.id, link]))
  const productMap = new Map(factPack.products.map((product) => [product.id, product]))
  const bodyParts: string[] = []
  const linkedCategoryIds = new Set<string>()
  const linkedProductIds = new Set<string>()
  const bodyTextParts: string[] = []
  const headingSet: string[] = []

  for (const section of article.sections) {
    headingSet.push(normalizeSeoText(section.heading))
    bodyTextParts.push(section.heading)
    bodyParts.push(`<h2>${escapeHtml(section.heading)}</h2>`)
    for (const paragraph of section.paragraphs) {
      bodyTextParts.push(paragraph)
      bodyParts.push(`<p>${escapeHtml(paragraph)}</p>`)
    }
  }

  const categoryLinks: SeoFactPackLink[] = []
  const productLinks: SeoFactPackLink[] = []

  for (const linkRef of article.internalLinks) {
    const link = linksById.get(linkRef.id)
    if (!link) continue
    if (link.type === 'category') categoryLinks.push(link)
    if (link.type === 'product') productLinks.push(link)
  }

  if (categoryLinks.length > 0 || productLinks.length > 0) {
    bodyParts.push('<h2>Ilgili kategoriler ve urunler</h2>')
    bodyParts.push('<ul>')
    for (const link of [...categoryLinks, ...productLinks]) {
      if (link.type === 'category') linkedCategoryIds.add(link.refId)
      if (link.type === 'product') linkedProductIds.add(link.refId)
      bodyParts.push(
        `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`,
      )
    }
    bodyParts.push('</ul>')
  }

  if (article.productMentions.length > 0) {
    bodyParts.push('<h2>Hanuja icinden onerilen urunler</h2>')
    bodyParts.push('<ul>')
    for (const mention of article.productMentions) {
      const product = productMap.get(mention.productId)
      if (!product) continue
      linkedProductIds.add(product.id)
      bodyTextParts.push(mention.reason)
      bodyParts.push(
        `<li><a href="/urun/${escapeHtml(product.slug)}">${escapeHtml(product.name)}</a>: ${escapeHtml(mention.reason)}</li>`,
      )
    }
    bodyParts.push('</ul>')
  }

  return {
    body: bodyParts.join('\n'),
    linkedCategoryIds: [...linkedCategoryIds],
    linkedProductIds: [...linkedProductIds],
    headingSet,
    bodyText: normalizeWhitespace(bodyTextParts.join(' ')),
  }
}

export function buildSeoBodySignature(input: {
  title: string
  metaDescription?: string | null
  headings?: string[]
  bodyText?: string | null
}): string[] {
  const corpus = [
    normalizeSeoText(input.title),
    normalizeSeoText(input.metaDescription ?? ''),
    ...(input.headings ?? []).map((heading) => normalizeSeoText(heading)),
    normalizeSeoText(input.bodyText ?? ''),
  ]
    .filter(Boolean)
    .join(' ')
  return buildShingles(corpus, 3)
}

export function similarityScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let intersection = 0

  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1
  }

  const union = new Set([...leftSet, ...rightSet]).size
  return union === 0 ? 0 : intersection / union
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function buildShingles(value: string, size: number): string[] {
  const tokens = value.split(/\s+/).filter(Boolean)
  if (tokens.length <= size) return tokens.length > 0 ? [tokens.join(' ')] : []

  const shingles: string[] = []
  for (let index = 0; index <= tokens.length - size; index += 1) {
    shingles.push(tokens.slice(index, index + size).join(' '))
  }
  return shingles
}

function hasOnlyKnownFactIds(sourceFactIds: string[], factIds: Set<string>) {
  return sourceFactIds.every((factId) => factIds.has(factId))
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3).trim()}...`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
