import { describe, expect, it } from 'vitest'
import {
  buildClusterKey,
  buildSeoArticleDraft,
  buildSeoTopicCandidates,
  classifySeoIntent,
  evaluateSeoCandidate,
  type SeoCategorySignal,
  type SeoProductSignal,
} from '@hanuja/api/domain/seo-topic-cluster'

const categories: SeoCategorySignal[] = [
  { id: 'cat-mobilya', slug: 'mobilya', name: 'Mobilya', parentId: null },
  { id: 'cat-sehpa', slug: 'sehpa', name: 'Sehpa', parentId: 'cat-mobilya' },
  { id: 'cat-aydinlatma', slug: 'aydinlatma', name: 'Aydinlatma', parentId: null },
  { id: 'cat-lamba', slug: 'masa-lambasi', name: 'Masa Lambasi', parentId: 'cat-aydinlatma' },
]

const products: SeoProductSignal[] = [
  {
    id: 'p1',
    slug: 'ahsap-orta-sehpa',
    name: 'Ahsap Orta Sehpa',
    categoryId: 'cat-sehpa',
    stockQuantity: 8,
    description: 'Kucuk salonlar icin dogal ahsap orta sehpa.',
    price: 2400,
    imageUrl: 'https://media.example/ahsap-sehpa.jpg',
  },
  {
    id: 'p2',
    slug: 'metal-ayakli-yan-sehpa',
    name: 'Metal Ayakli Yan Sehpa',
    categoryId: 'cat-sehpa',
    stockQuantity: 5,
    description: 'Modern salon ve ofis kullanimi icin yan sehpa.',
    price: 1800,
  },
  {
    id: 'p3',
    slug: 'ofis-sehpasi',
    name: 'Ofis Sehpası',
    categoryId: 'cat-sehpa',
    stockQuantity: 3,
    description: 'Bekleme alanlari icin sade ofis sehpası.',
    price: 3200,
  },
  {
    id: 'p4',
    slug: 'modern-masa-lambasi',
    name: 'Modern Masa Lambasi',
    categoryId: 'cat-lamba',
    stockQuantity: 6,
    description: 'Calisma masasi icin ayarlanabilir masa lambasi.',
    price: 950,
  },
]

describe('seo topic clusters', () => {
  it('classifies search intent from Turkish long-tail phrases', () => {
    expect(classifySeoIntent('kucuk salon orta sehpa olculeri')).toBe('measurement_advice')
    expect(classifySeoIntent('modern yan sehpa kullanim fikirleri')).toBe('usage_idea')
    expect(classifySeoIntent('ahsap orta sehpa mi metal ayakli orta sehpa mi')).toBe('comparison')
    expect(classifySeoIntent('orta sehpa nasil secilir')).toBe('informational')
  })

  it('generates broad sub-intent candidates across categories, not only the sample sehpa topic', () => {
    const candidates = buildSeoTopicCandidates({
      categories,
      products,
      demandSignals: [
        { source: 'site', query: 'kucuk salon orta sehpa', count: 4 },
        {
          source: 'gsc',
          query: 'masa lambasi calisma odasi',
          impressions: 120,
          clicks: 1,
          position: 18,
        },
      ],
    })

    const sehpaCandidates = candidates.filter((candidate) => candidate.category.slug === 'sehpa')
    const lambaCandidates = candidates.filter(
      (candidate) => candidate.category.slug === 'masa-lambasi',
    )

    expect(sehpaCandidates.length).toBeGreaterThanOrEqual(20)
    expect(lambaCandidates.length).toBeGreaterThan(0)
    expect(
      candidates.some((candidate) => candidate.targetKeyword.includes('kucuk salon orta sehpa')),
    ).toBe(true)
    expect(candidates.some((candidate) => candidate.targetKeyword.includes('masa lambasi'))).toBe(
      true,
    )
  })

  it('marks an already-covered cluster as not publishable', () => {
    const duplicateKey = buildClusterKey('sehpa', 'sehpa nasil secilir')
    const candidates = buildSeoTopicCandidates({
      categories,
      products,
      existingContent: [{ clusterKey: duplicateKey, targetKeyword: 'sehpa nasil secilir' }],
      maxCandidatesPerCategory: 100,
    })
    const duplicate = candidates.find((candidate) => candidate.clusterKey === duplicateKey)

    expect(duplicate).toBeDefined()
    expect(evaluateSeoCandidate(duplicate!).approved).toBe(false)
  })

  it('blocks publishing when a category has no real products', () => {
    const candidates = buildSeoTopicCandidates({
      categories: [{ id: 'empty', slug: 'bos-kategori', name: 'Bos Kategori', parentId: null }],
      products: [],
    })

    expect(candidates.length).toBeGreaterThan(0)
    expect(evaluateSeoCandidate(candidates[0]!).approved).toBe(false)
    expect(evaluateSeoCandidate(candidates[0]!).reasons).toContain('no_real_products_in_category')
  })

  it('builds an article draft with server-rendered category and product links', () => {
    const candidate = buildSeoTopicCandidates({ categories, products }).find(
      (item) => item.category.slug === 'sehpa' && evaluateSeoCandidate(item).approved,
    )

    expect(candidate).toBeDefined()
    const draft = buildSeoArticleDraft({ candidate: candidate!, products })

    expect(draft.body).toContain('href="/kategori/sehpa"')
    expect(draft.body).toContain('href="/urun/')
    expect(draft.coverUrl).toBe('https://media.example/ahsap-sehpa.jpg')
  })
})
