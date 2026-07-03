import { describe, expect, it } from 'vitest'
import {
  buildSeoFactPack,
  buildSeoPromptEnvelope,
  renderGeneratedSeoArticle,
  validateGeneratedSeoArticle,
  type SeoStructuredArticle,
} from '@hanuja/api/domain/seo-generated-content'
import type { SearchDemandSignal, SeoProductSignal, SeoTopicCandidate } from '@hanuja/api/domain/seo-topic-cluster'

const candidate: SeoTopicCandidate = {
  rootTopic: 'sehpa',
  subIntent: 'kucuk salon orta sehpa olculeri',
  intentType: 'measurement_advice',
  targetKeyword: 'kucuk salon orta sehpa olculeri',
  supportingKeywords: ['orta sehpa', 'kucuk salon', 'olcu secimi'],
  linkedCategoryIds: ['cat-sehpa'],
  linkedProductIds: ['p1', 'p2'],
  clusterKey: 'sehpa:kucuk-salon-orta-sehpa-olculeri',
  category: { id: 'cat-sehpa', slug: 'sehpa', name: 'Sehpa', parentId: 'cat-mobilya' },
  productCount: 2,
  demandScore: 18,
  qualityScore: 82,
  reasons: [],
}

const products: SeoProductSignal[] = [
  {
    id: 'p1',
    slug: 'ahsap-orta-sehpa',
    name: 'Ahsap Orta Sehpa',
    categoryId: 'cat-sehpa',
    stockQuantity: 9,
    description: 'Dogal tonlarda, kucuk salonlara uyumlu orta sehpa.',
    price: 2490,
    imageUrl: 'https://media.example/p1.jpg',
  },
  {
    id: 'p2',
    slug: 'metal-ayakli-orta-sehpa',
    name: 'Metal Ayakli Orta Sehpa',
    categoryId: 'cat-sehpa',
    stockQuantity: 6,
    description: 'Dar alanlarda hava katan acik ayak formu.',
    price: 2890,
    imageUrl: 'https://media.example/p2.jpg',
  },
]

const demandSignals: SearchDemandSignal[] = [
  { source: 'site', query: 'kucuk salon orta sehpa', count: 7 },
]

function buildValidArticle(factPack = buildSeoFactPack({ candidate, products, demandSignals })): SeoStructuredArticle {
  return {
    title: 'Kucuk Salon Icin Orta Sehpa Olculeri',
    summary:
      'Kucuk salonlarda orta sehpa secerken gecis alani, oturma duzeni ve gorsel hafiflik birlikte dusunulmelidir. Bu rehber Hanuja kategorisine baglanir.',
    metaDescription:
      'Kucuk salon icin orta sehpa olculeri secilirken gecis alani, derinlik ve kullanim senaryosu nasil dengelenir sorusuna Hanuja verileriyle yanit veren rehber.',
    imagePrompt:
      'Dogal isik alan modern bir kucuk salonda orta sehpa odakta, dengeli kompozisyon, yazisiz, logosuz, editorial urun fotografi estegi',
    sections: [
      {
        heading: 'Gecis alanini rahat birakmak',
        paragraphs: [
          'Kucuk salonlarda orta sehpa secimi yaparken koltuk ile sehpa arasindaki hareket alani daralmamali ve oturma akisi rahat kalmalidir.',
        ],
        sourceFactIds: [factPack.category.factId],
      },
      {
        heading: 'Derinligi hafif gosteren formlar',
        paragraphs: [
          'Acik ayakli ve gorsel olarak hafif duran formlar, kucuk salonlarda sehpanin alani bastirmadan yerlesmesine yardim eder.',
        ],
        sourceFactIds: [factPack.products[1]!.factId],
      },
      {
        heading: 'Kategori icinde karsilastirma yapmak',
        paragraphs: [
          'Once kategori icindeki olculeri yan yana acip derinlik ve yuzey ihtiyacini netlestirmek, gereksiz buyuk modellere kaymayi engeller.',
        ],
        sourceFactIds: [factPack.category.factId, factPack.demandSignals[0]!.factId],
      },
    ],
    internalLinks: factPack.allowedInternalLinks.slice(0, 3).map((link) => ({
      id: link.id,
      href: link.href,
      label: link.label,
      type: link.type,
      refId: link.refId,
      sourceFactIds: link.sourceFactIds,
    })),
    productMentions: factPack.products.slice(0, 2).map((product) => ({
      productId: product.id,
      title: product.name,
      reason:
        product.id === 'p1'
          ? 'Dogal tonlu yuzeyi ve daha sicak etkisiyle kucuk salon kurgularinda sade kombinlere kolay uyum saglar.'
          : 'Acik ayak formu sayesinde zemini daha gorunur birakir ve sikisiklik hissini azaltmaya yardim eder.',
      sourceFactIds: [product.factId],
    })),
  }
}

describe('seo generated content', () => {
  it('builds a stable prompt envelope with a prompt hash', () => {
    const factPack = buildSeoFactPack({ candidate, products, demandSignals })
    const prompt = buildSeoPromptEnvelope(factPack)

    expect(prompt.instructions).toContain('Sadece verilen fact pack icindeki')
    expect(prompt.input).toContain('"targetKeyword": "kucuk salon orta sehpa olculeri"')
    expect(prompt.promptHash).toHaveLength(64)
  })

  it('validates and renders a grounded article', () => {
    const factPack = buildSeoFactPack({ candidate, products, demandSignals })
    const article = buildValidArticle(factPack)
    const validation = validateGeneratedSeoArticle(article, factPack)
    const rendered = renderGeneratedSeoArticle(article, factPack)

    expect(validation.decision).toBe('pass')
    expect(rendered.body).toContain('href="/kategori/sehpa"')
    expect(rendered.body).toContain('href="/urun/ahsap-orta-sehpa"')
    expect(rendered.linkedProductIds).toContain('p1')
  })

  it('rejects unsupported claims and links outside the allowlist', () => {
    const factPack = buildSeoFactPack({ candidate, products, demandSignals })
    const article = buildValidArticle(factPack)
    article.sections[0]!.paragraphs = ['Bu model 2.490 TL fiyatla stokta ve ucretsiz kargo ile gelir.']
    article.internalLinks[0] = {
      id: 'foreign-link',
      href: 'https://example.com/dis-link',
      label: 'Dis baglanti',
      type: 'category',
      refId: 'foreign',
      sourceFactIds: [factPack.category.factId],
    }

    const validation = validateGeneratedSeoArticle(article, factPack)
    expect(validation.decision).toBe('reject')
    expect(validation.reasons).toContain('unsupported_claim_pattern')
    expect(validation.reasons).toContain('link_not_allowlisted')
  })
})
