import { normalizeSlug } from './slug'

export const SEO_CONTENT_INTENT_TYPES = [
  'product_search',
  'category_search',
  'informational',
  'comparison',
  'measurement_advice',
  'usage_idea',
] as const

export type SeoContentIntentType = (typeof SEO_CONTENT_INTENT_TYPES)[number]

export type SearchDemandSource = 'site' | 'gsc'

export interface SeoCategorySignal {
  id: string
  slug: string
  name: string
  parentId?: string | null
}

export interface SeoProductSignal {
  id: string
  slug: string
  name: string
  categoryId: string | null
  stockQuantity: number
  description?: string | null
  price?: number | null
  imageUrl?: string | null
}

export interface SearchDemandSignal {
  query: string
  source: SearchDemandSource
  count?: number
  impressions?: number
  clicks?: number
  position?: number
}

export interface ExistingSeoContentSignal {
  clusterKey?: string | null
  targetKeyword?: string | null
  title?: string | null
}

export interface SeoTopicCandidate {
  rootTopic: string
  subIntent: string
  intentType: SeoContentIntentType
  targetKeyword: string
  supportingKeywords: string[]
  linkedCategoryIds: string[]
  linkedProductIds: string[]
  clusterKey: string
  category: SeoCategorySignal
  productCount: number
  demandScore: number
  qualityScore: number
  reasons: string[]
}

export interface SeoCandidateEvaluation {
  approved: boolean
  score: number
  reasons: string[]
}

const STOP_WORDS = new Set([
  've',
  'ile',
  'icin',
  'bir',
  'bu',
  'cok',
  'urun',
  'model',
  'set',
  'adet',
  'yeni',
  'ev',
])

const STYLE_MODIFIERS = ['modern', 'minimalist', 'sade', 'dogal', 'endustriyel']
const MATERIAL_MODIFIERS = ['ahsap', 'metal', 'cam', 'mermer', 'seramik', 'rattan']
const ROOM_MODIFIERS = ['salon', 'ofis', 'mutfak', 'banyo', 'yatak odasi', 'dar alan']
const USE_CASE_MODIFIERS = ['olcu secimi', 'kullanim fikirleri', 'bakim onerileri']

export function buildClusterKey(categorySlug: string, targetKeyword: string): string {
  return `${categorySlug}:${normalizeSlug(targetKeyword)}`
}

export function normalizeSeoText(input: string): string {
  return input.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ')
}

export function classifySeoIntent(keyword: string): SeoContentIntentType {
  const normalized = normalizeSeoText(keyword)
  const ascii = normalizeSeoAscii(normalized)

  if (
    containsAny(normalized, [' mi ', ' mu ', ' mu ', ' vs ', 'karsilastirma', 'farki']) ||
    containsAny(ascii, [' mi ', ' mu ', ' mu ', ' vs ', 'karsilastirma', 'farki'])
  ) {
    return 'comparison'
  }

  if (
    containsAny(normalized, ['olcu', 'olculeri', 'boyut', 'kac cm', 'hesaplama', 'ebat']) ||
    containsAny(ascii, ['olcu', 'olculeri', 'boyut', 'kac cm', 'hesaplama', 'ebat'])
  ) {
    return 'measurement_advice'
  }

  if (
    containsAny(normalized, ['kullanim', 'fikir', 'dekorasyon', 'yerlesim', 'kombin']) ||
    containsAny(ascii, ['kullanim', 'fikir', 'dekorasyon', 'yerlesim', 'kombin'])
  ) {
    return 'usage_idea'
  }

  if (
    containsAny(normalized, ['nasil', 'rehber', 'secilir', 'bakim', 'oneri']) ||
    containsAny(ascii, ['nasil', 'rehber', 'secilir', 'bakim', 'oneri'])
  ) {
    return 'informational'
  }

  if (
    containsAny(normalized, ['kategori', 'cesitleri', 'modelleri']) ||
    containsAny(ascii, ['kategori', 'cesitleri', 'modelleri'])
  ) {
    return 'category_search'
  }

  return 'product_search'
}

function containsAny(value: string, needles: string[]): boolean {
  const padded = ` ${value} `
  return needles.some((needle) => padded.includes(needle))
}

function normalizeSeoAscii(value: string): string {
  return value
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
}

export function buildSeoTopicCandidates(input: {
  categories: SeoCategorySignal[]
  products: SeoProductSignal[]
  demandSignals?: SearchDemandSignal[]
  existingContent?: ExistingSeoContentSignal[]
  maxCandidatesPerCategory?: number
}): SeoTopicCandidate[] {
  const demandSignals = input.demandSignals ?? []
  const existingContent = input.existingContent ?? []
  const existingClusterKeys = new Set(
    existingContent.map((item) => item.clusterKey).filter(Boolean) as string[],
  )
  const existingTargets = new Set(
    existingContent
      .map((item) => item.targetKeyword ?? item.title)
      .filter(Boolean)
      .map((value) => normalizeSeoText(value as string)),
  )
  const childrenByParent = groupBy(input.categories, (category) => category.parentId ?? '')
  const productsByCategory = groupBy(input.products, (product) => product.categoryId ?? '')
  const candidates: SeoTopicCandidate[] = []

  for (const category of input.categories) {
    const relatedProducts = productsByCategory.get(category.id) ?? []
    const rawKeywords = buildRawKeywordsForCategory({
      category,
      children: childrenByParent.get(category.id) ?? [],
      products: relatedProducts,
      demandSignals,
    })

    const seenKeywords = new Set<string>()
    const categoryCandidates: SeoTopicCandidate[] = []

    for (const keyword of rawKeywords) {
      const targetKeyword = normalizeSeoText(keyword)
      if (!targetKeyword || seenKeywords.has(targetKeyword)) continue
      seenKeywords.add(targetKeyword)

      const clusterKey = buildClusterKey(category.slug, targetKeyword)
      const intentType = classifySeoIntent(targetKeyword)
      const linkedProducts = pickLinkedProducts(targetKeyword, relatedProducts)
      const scoring = scoreCandidate({
        targetKeyword,
        clusterKey,
        intentType,
        category,
        productCount: relatedProducts.length,
        demandSignals,
        existingClusterKeys,
        existingTargets,
      })

      categoryCandidates.push({
        rootTopic: normalizeSeoText(category.name),
        subIntent: targetKeyword,
        intentType,
        targetKeyword,
        supportingKeywords: buildSupportingKeywords(targetKeyword, category.name),
        linkedCategoryIds: [category.id],
        linkedProductIds: linkedProducts.map((product) => product.id),
        clusterKey,
        category,
        productCount: relatedProducts.length,
        demandScore: scoring.demandScore,
        qualityScore: scoring.score,
        reasons: scoring.reasons,
      })
    }

    candidates.push(
      ...categoryCandidates
        .sort((left, right) => right.qualityScore - left.qualityScore)
        .slice(0, input.maxCandidatesPerCategory ?? 30),
    )
  }

  return candidates.sort((left, right) => right.qualityScore - left.qualityScore)
}

export function evaluateSeoCandidate(candidate: SeoTopicCandidate): SeoCandidateEvaluation {
  const reasons = [...candidate.reasons]

  if (candidate.linkedCategoryIds.length === 0) {
    reasons.push('missing_category_link')
  }

  if (candidate.productCount < 1) {
    reasons.push('no_real_products_in_category')
  }

  if (candidate.supportingKeywords.length < 3) {
    reasons.push('weak_supporting_keywords')
  }

  if (candidate.qualityScore < 55) {
    reasons.push('score_below_publish_threshold')
  }

  if (candidate.reasons.includes('duplicate_cluster')) {
    reasons.push('duplicate_intent')
  }

  return {
    approved:
      reasons.length === 0 ||
      reasons.every((reason) => reason === 'long_tail_boost' || reason === 'demand_boost'),
    score: candidate.qualityScore,
    reasons: [...new Set(reasons)],
  }
}

export function buildSeoArticleDraft(input: {
  candidate: SeoTopicCandidate
  products: SeoProductSignal[]
}): {
  title: string
  summary: string
  body: string
  coverUrl?: string
} {
  const { candidate } = input
  const products = input.products.filter((product) =>
    candidate.linkedProductIds.includes(product.id),
  )
  const title = toTitleCase(candidate.targetKeyword)
  const categoryLink = `/kategori/${candidate.category.slug}`
  const productList = products.length
    ? `<ul>${products
        .map(
          (product) =>
            `<li><a href="/urun/${escapeHtml(product.slug)}">${escapeHtml(product.name)}</a>${formatPrice(product.price)}</li>`,
        )
        .join('')}</ul>`
    : '<p>Bu rehberde once kategori secimini netlestirip ardindan uygun urunleri incelemeniz onerilir.</p>'

  const summary = `${title} arayanlar icin ${candidate.category.name} kategorisine bagli, olcu, malzeme ve kullanim ihtiyacini birlikte dusunen Hanuja rehberi.`
  const body = [
    `<p><strong>${escapeHtml(title)}</strong> aramasi genellikle tek bir urun isminden fazlasini anlatir: olcu, stil, malzeme ve kullanilacak alan birlikte dusunulmelidir. Hanuja'da ilgili secenekleri <a href="${escapeHtml(categoryLink)}">${escapeHtml(candidate.category.name)}</a> kategorisinde birlikte inceleyebilirsiniz.</p>`,
    '<h2>Bu niyet hangi ihtiyaca cevap veriyor?</h2>',
    `<p>${escapeHtml(candidate.targetKeyword)} konusu, kullanicinin satin almadan once kararini daraltmak istedigi bir alt niyettir. Bu nedenle once alanin boyutu, mevcut mobilyalarla uyum ve gunluk kullanim sikligi netlestirilmelidir.</p>`,
    '<h2>Secim yaparken dikkat edilecek noktalar</h2>',
    `<p>${escapeHtml(candidate.supportingKeywords.slice(0, 4).join(', '))} basliklari bu karar icin ana kontrol listesidir. Olcu uygun degilse iyi gorunen bir urun bile alanda hantal kalabilir; malzeme ve renk uyumu ise kategori icindeki secenekleri hizla elemenizi saglar.</p>`,
    products.length ? '<h2>Hanuja icinden ilgili urunler</h2>' : '<h2>Hanuja icinde nasil ilerlemeli?</h2>',
    productList,
    '<h2>Sonraki adim</h2>',
    `<p>Once <a href="${escapeHtml(categoryLink)}">${escapeHtml(candidate.category.name)}</a> kategorisinde benzer urunleri yan yana acin, sonra olcu ve malzeme filtresiyle listeyi daraltin. Bu yaklasim, sadece genel bir kelimeye degil, gercek kullanim ihtiyaciniza gore karar vermenizi saglar.</p>`,
  ].join('\n\n')

  return {
    title,
    summary,
    body,
    ...(products[0]?.imageUrl ? { coverUrl: products[0].imageUrl } : {}),
  }
}

function buildRawKeywordsForCategory(input: {
  category: SeoCategorySignal
  children: SeoCategorySignal[]
  products: SeoProductSignal[]
  demandSignals: SearchDemandSignal[]
}): string[] {
  const root = normalizeSeoText(input.category.name)
  const keywords = new Set<string>()

  keywords.add(`${root} nasil secilir`)
  keywords.add(`${root} olcu secimi`)
  keywords.add(`${root} kullanim fikirleri`)
  keywords.add(`modern ${root}`)
  keywords.add(`kucuk alanlar icin ${root}`)

  for (const child of input.children) {
    const childTopic = normalizeSeoText(child.name)
    keywords.add(childTopic)
    keywords.add(`${childTopic} nasil secilir`)
    keywords.add(`${childTopic} kullanim fikirleri`)
    keywords.add(`${childTopic} olculeri`)
  }

  for (const modifier of STYLE_MODIFIERS) keywords.add(`${modifier} ${root}`)
  for (const modifier of MATERIAL_MODIFIERS) keywords.add(`${modifier} ${root}`)
  for (const room of ROOM_MODIFIERS) keywords.add(`${room} icin ${root}`)
  for (const useCase of USE_CASE_MODIFIERS) keywords.add(`${root} ${useCase}`)

  for (const token of extractProductTokens(input.products).slice(0, 16)) {
    keywords.add(`${token} ${root}`)
    keywords.add(`${token} ${root} nasil secilir`)
  }

  for (const signal of input.demandSignals) {
    if (matchesCategoryDemand(signal.query, input.category, input.products)) {
      keywords.add(signal.query)
    }
  }

  return [...keywords]
}

function scoreCandidate(input: {
  targetKeyword: string
  clusterKey: string
  intentType: SeoContentIntentType
  category: SeoCategorySignal
  productCount: number
  demandSignals: SearchDemandSignal[]
  existingClusterKeys: Set<string>
  existingTargets: Set<string>
}): { score: number; demandScore: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 25

  if (input.productCount >= 5) score += 25
  else if (input.productCount >= 2) score += 18
  else if (input.productCount >= 1) score += 10

  const wordCount = input.targetKeyword.split(/\s+/).length
  if (wordCount >= 3) {
    score += 10
    reasons.push('long_tail_boost')
  }

  if (input.intentType === 'measurement_advice' || input.intentType === 'usage_idea') score += 8
  if (input.intentType === 'comparison') score += 6

  const demandScore = calculateDemandScore(input.targetKeyword, input.demandSignals)
  if (demandScore > 0) {
    score += demandScore
    reasons.push('demand_boost')
  }

  if (input.existingClusterKeys.has(input.clusterKey)) {
    score -= 100
    reasons.push('duplicate_cluster')
  }

  if (input.existingTargets.has(normalizeSeoText(input.targetKeyword))) {
    score -= 60
    reasons.push('duplicate_target_keyword')
  }

  return { score, demandScore, reasons }
}

function calculateDemandScore(keyword: string, demandSignals: SearchDemandSignal[]): number {
  const normalizedKeyword = normalizeSeoText(keyword)
  let score = 0

  for (const signal of demandSignals) {
    const query = normalizeSeoText(signal.query)
    if (
      query !== normalizedKeyword &&
      !query.includes(normalizedKeyword) &&
      !normalizedKeyword.includes(query)
    ) {
      continue
    }

    if (signal.source === 'site') {
      score += Math.min(16, (signal.count ?? 1) * 3)
    } else {
      const impressions = signal.impressions ?? 0
      const clicks = signal.clicks ?? 0
      const position = signal.position ?? 99
      score += Math.min(18, Math.round(impressions / 20))
      if (impressions >= 20 && clicks <= 1) score += 6
      if (position >= 8 && position <= 40) score += 6
    }
  }

  return Math.min(28, score)
}

function buildSupportingKeywords(targetKeyword: string, categoryName: string): string[] {
  const normalizedCategory = normalizeSeoText(categoryName)
  return [
    targetKeyword,
    `${normalizedCategory} modelleri`,
    `${normalizedCategory} olculeri`,
    `${normalizedCategory} malzeme secimi`,
    `${normalizedCategory} dekorasyon fikirleri`,
  ].filter((value, index, array) => array.indexOf(value) === index)
}

function pickLinkedProducts(keyword: string, products: SeoProductSignal[]): SeoProductSignal[] {
  const normalizedKeyword = normalizeSeoText(keyword)
  const scored = products.map((product) => {
    const haystack = normalizeSeoText(`${product.name} ${product.description ?? ''}`)
    const keywordTokens = normalizedKeyword.split(/\s+/)
    const matches = keywordTokens.filter(
      (token) => token.length > 2 && haystack.includes(token),
    ).length
    return { product, score: matches }
  })

  return scored
    .sort(
      (left, right) =>
        right.score - left.score || left.product.name.localeCompare(right.product.name, 'tr'),
    )
    .slice(0, 3)
    .map((item) => item.product)
}

function matchesCategoryDemand(
  query: string,
  category: SeoCategorySignal,
  products: SeoProductSignal[],
): boolean {
  const normalizedQuery = normalizeSeoText(query)
  const categoryTokens = [...normalizeSeoText(category.name).split(/\s+/), ...category.slug.split('-')].filter(
    (token) => token.length > 2,
  )

  if (categoryTokens.some((token) => normalizedQuery.includes(token))) return true

  return extractProductTokens(products)
    .slice(0, 20)
    .some((token) => normalizedQuery.includes(token))
}

function extractProductTokens(products: SeoProductSignal[]): string[] {
  const counts = new Map<string, number>()

  for (const product of products) {
    for (const token of normalizeSeoText(product.name).split(/\s+/)) {
      const normalizedToken = token.replace(/[^\p{L}\p{N}]/gu, '')
      if (normalizedToken.length < 3 || STOP_WORDS.has(normalizedToken)) continue
      counts.set(normalizedToken, (counts.get(normalizedToken) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'tr'))
    .map(([token]) => token)
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const key = getKey(item)
    const group = grouped.get(key) ?? []
    group.push(item)
    grouped.set(key, group)
  }
  return grouped
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => (part ? part[0]!.toLocaleUpperCase('tr-TR') + part.slice(1) : part))
    .join(' ')
}

function formatPrice(price?: number | null): string {
  if (price === null || price === undefined) return ''
  return ` - ${price.toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  })}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
