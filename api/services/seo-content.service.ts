import type { Prisma, PrismaClient } from '@prisma/client'
import { normalizeSlug } from '../domain/slug'
import {
  SEO_OPENAI_PROMPT_VERSION,
  SEO_OPENAI_SCHEMA_VERSION,
  buildSeoBodySignature,
  buildSeoFactPack,
  renderGeneratedSeoArticle,
  sha256,
  similarityScore,
  validateGeneratedSeoArticle,
  type SeoFactPack,
} from '../domain/seo-generated-content'
import {
  buildSeoTopicCandidates,
  evaluateSeoCandidate,
  normalizeSeoText,
  type SearchDemandSignal,
  type SeoProductSignal,
  type SeoTopicCandidate,
} from '../domain/seo-topic-cluster'
import { ConflictError, DomainError } from '../lib/errors'
import { deleteObject } from '../lib/r2'
import { createSearchConsoleService } from './search-console.service'
import { createSeoImageService } from './seo-image.service'
import { createSeoOpenAiService, isTransientOpenAiError } from './seo-openai.service'

const DEFAULT_MAX_POSTS_PER_RUN = 1
const DEFAULT_LOOKBACK_DAYS = 30
const SEO_GENERATOR_ID = 'seo-topical-authority-openai-v1'
const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const

export type SeoContentRunMode = 'dry_run' | 'draft' | 'publish'

export interface SeoContentAutomationResult {
  runId: string | null
  mode: SeoContentRunMode
  status: 'disabled' | 'no_candidates' | 'completed' | 'rolled_back'
  evaluatedCandidates: number
  approvedCandidates: number
  draftedPosts: Array<{ id: string; slug: string; title: string; clusterKey: string }>
  publishedPosts: Array<{ id: string; slug: string; title: string; clusterKey: string }>
  skippedReasons: Record<string, number>
  totals: {
    estimatedCostUsd: number
    textInputTokens: number
    textOutputTokens: number
    imageCount: number
  }
}

export interface SeoContentAutomationOptions {
  force?: boolean
  mode?: SeoContentRunMode
  dryRun?: boolean
  maxPosts?: number
  now?: Date
  runId?: string
  triggeredBy?: string | null
}

interface ExistingSeoContentRecord {
  id: string
  slug: string
  title: string
  summary: string | null
  body: string
  status: string
  clusterKey: string | null
  targetKeyword: string | null
  generationMetadata: Prisma.JsonValue | null
}

export function createSeoContentService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps
  const seoOpenAi = createSeoOpenAiService()
  const searchConsole = createSearchConsoleService()
  const seoImage = createSeoImageService({ prisma })

  async function createRun(input: {
    mode: SeoContentRunMode
    triggeredBy?: string | null
    maxPosts?: number
  }) {
    await ensureNoActiveRun()
    const runBudgetUsd = getNumberEnv('SEO_CONTENT_OPENAI_RUN_BUDGET_USD', 0)
    const dailyBudgetUsd = getNumberEnv('SEO_CONTENT_OPENAI_DAILY_BUDGET_USD', 0)

    return prisma.seoContentRun.create({
      data: {
        mode: input.mode,
        status: 'queued',
        triggeredBy: input.triggeredBy ?? null,
        budgetSnapshot: asJson({
          runBudgetUsd,
          dailyBudgetUsd,
          maxPosts: input.maxPosts ?? DEFAULT_MAX_POSTS_PER_RUN,
        }),
      },
      select: { id: true, mode: true, status: true },
    })
  }

  async function runWeeklyTopicalAuthorityAutomation(
    options: SeoContentAutomationOptions = {},
  ): Promise<SeoContentAutomationResult> {
    const explicitMode = normalizeMode(options)
    const isManual = Boolean(options.runId || options.mode || options.triggeredBy)

    if (!isManual && process.env['SEO_CONTENT_AUTOMATION_ENABLED'] !== 'true') {
      return emptyResult(explicitMode, 'disabled')
    }

    const now = options.now ?? new Date()
    const run = options.runId
      ? await prisma.seoContentRun.findUnique({
          where: { id: options.runId },
          select: { id: true, mode: true, status: true },
        })
      : await createRun({
          mode: explicitMode,
          triggeredBy: options.triggeredBy ?? 'system-seo',
          ...(options.maxPosts !== undefined ? { maxPosts: options.maxPosts } : {}),
        })

    if (!run) {
      throw new DomainError('SEO run bulunamadi.', 'SEO_RUN_NOT_FOUND', 404)
    }

    await ensureNoActiveRun(run.id)
    await prisma.seoContentRun.update({
      where: { id: run.id },
      data: {
        status: 'running',
        startedAt: now,
      },
    })

    const configuredMaxPosts = getNumberEnv('SEO_CONTENT_MAX_POSTS_PER_RUN', DEFAULT_MAX_POSTS_PER_RUN)
    const maxPosts = Math.max(1, options.maxPosts ?? configuredMaxPosts)

    const [categories, products, siteDemandSignals, gscDemandSignals, existingContent] =
      await Promise.all([
        listActiveCategories(),
        listPublishedProductSignals(),
        listSiteSearchDemandSignals(now),
        listSearchConsoleDemandSignals(now),
        listExistingSeoContent(),
      ])

    const demandSignals = [...siteDemandSignals, ...gscDemandSignals]
    const candidates = buildSeoTopicCandidates({
      categories,
      products,
      demandSignals,
      existingContent,
      maxCandidatesPerCategory: 40,
    })

    const evaluations = candidates.map((candidate) => evaluateCandidate(candidate, {
      categories,
      products,
      existingContent,
    }))

    await recordSkippedEvaluations(run.id, evaluations.filter((item) => !item.approved))

    const approved = evaluations
      .filter((item) => item.approved)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxPosts)

    const skippedReasons = summarizeSkippedReasons(evaluations)

    if (approved.length === 0) {
      await finalizeRun(run.id, 'completed', {
        evaluatedCandidates: candidates.length,
        approvedCandidates: 0,
        draftedPosts: [],
        publishedPosts: [],
        skippedReasons,
        totals: zeroTotals(),
      })

      return {
        runId: run.id,
        mode: explicitMode,
        status: 'no_candidates',
        evaluatedCandidates: candidates.length,
        approvedCandidates: 0,
        draftedPosts: [],
        publishedPosts: [],
        skippedReasons,
        totals: zeroTotals(),
      }
    }

    const draftedPosts: SeoContentAutomationResult['draftedPosts'] = []
    const publishedPosts: SeoContentAutomationResult['publishedPosts'] = []
    const totals = zeroTotals()
    let rolledBack = false

    for (const approvedCandidate of approved) {
      if (await budgetsExceeded(now, totals.estimatedCostUsd)) {
        skippedReasons['budget_exceeded'] = (skippedReasons['budget_exceeded'] ?? 0) + 1
        break
      }

      const result = await processApprovedCandidate({
        runId: run.id,
        candidate: approvedCandidate.candidate,
        products,
        demandSignals,
        existingContent,
        mode: explicitMode,
        now,
      })

      if (result.status === 'skipped') {
        skippedReasons[result.reason] = (skippedReasons[result.reason] ?? 0) + 1
        continue
      }

      totals.estimatedCostUsd += result.estimatedCostUsd
      totals.textInputTokens += result.tokenUsage.inputTokens
      totals.textOutputTokens += result.tokenUsage.outputTokens
      if (result.status === 'dry_run_ok') {
        continue
      }
      totals.imageCount += result.imageCount
      draftedPosts.push(result.post)
      if (result.published) publishedPosts.push(result.post)

      if (result.publishAcceptanceFailed) {
        rolledBack = true
        await rollbackPublishedPosts(run.id)
        break
      }
    }

    const finalStatus = rolledBack ? 'rolled_back' : 'completed'
    await finalizeRun(run.id, finalStatus, {
      evaluatedCandidates: candidates.length,
      approvedCandidates: approved.length,
      draftedPosts,
      publishedPosts,
      skippedReasons,
      totals,
    })

    return {
      runId: run.id,
      mode: explicitMode,
      status: rolledBack ? 'rolled_back' : 'completed',
      evaluatedCandidates: candidates.length,
      approvedCandidates: approved.length,
      draftedPosts,
      publishedPosts,
      skippedReasons,
      totals,
    }
  }

  async function listActiveCategories() {
    return prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, parentId: true },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    })
  }

  async function listPublishedProductSignals(): Promise<SeoProductSignal[]> {
    const rows = await prisma.product.findMany({
      where: {
        status: 'published',
        stockQuantity: { gt: 0 },
        categoryId: { not: null },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        categoryId: true,
        stockQuantity: true,
        price: true,
        images: {
          take: 1,
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          select: { url: true },
        },
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 1500,
    })

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      categoryId: row.categoryId,
      stockQuantity: row.stockQuantity,
      description: row.description,
      price: decimalToNumber(row.price),
      imageUrl: row.images[0]?.url ?? null,
    }))
  }

  async function listSiteSearchDemandSignals(now: Date): Promise<SearchDemandSignal[]> {
    const since = daysAgo(now, DEFAULT_LOOKBACK_DAYS)
    const rows = await prisma.siteSearchQuery.findMany({
      where: { createdAt: { gte: since } },
      select: { normalizedQuery: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })
    const counts = new Map<string, number>()

    for (const row of rows) {
      counts.set(row.normalizedQuery, (counts.get(row.normalizedQuery) ?? 0) + 1)
    }

    return [...counts.entries()].map(([query, count]) => ({
      source: 'site' as const,
      query,
      count,
    }))
  }

  async function listSearchConsoleDemandSignals(now: Date): Promise<SearchDemandSignal[]> {
    try {
      return await searchConsole.listQuerySignals({
        startDate: daysAgo(now, DEFAULT_LOOKBACK_DAYS),
        endDate: daysAgo(now, 2),
        rowLimit: 500,
      })
    } catch (error) {
      console.error('[seo-content] Search Console signals skipped:', error)
      return []
    }
  }

  async function listExistingSeoContent(): Promise<ExistingSeoContentRecord[]> {
    return prisma.blogPost.findMany({
      where: {
        OR: [
          { clusterKey: { not: null } },
          { targetKeyword: { not: null } },
          { generatedBy: { not: null } },
        ],
      },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        body: true,
        status: true,
        clusterKey: true,
        targetKeyword: true,
        generationMetadata: true,
      },
    })
  }

  async function processApprovedCandidate(input: {
    runId: string
    candidate: SeoTopicCandidate
    products: SeoProductSignal[]
    demandSignals: SearchDemandSignal[]
    existingContent: ExistingSeoContentRecord[]
    mode: SeoContentRunMode
    now: Date
  }): Promise<
    | {
        status: 'skipped'
        reason: string
      }
    | {
        status: 'dry_run_ok'
        estimatedCostUsd: number
        tokenUsage: { inputTokens: number; outputTokens: number }
      }
    | {
        status: 'ok'
        post: { id: string; slug: string; title: string; clusterKey: string }
        published: boolean
        estimatedCostUsd: number
        tokenUsage: { inputTokens: number; outputTokens: number }
        imageCount: number
        publishAcceptanceFailed: boolean
      }
  > {
    const idempotencyKey = buildIdempotencyKey(input.candidate.clusterKey)
    const existingAttempt = await prisma.seoContentGeneration.findFirst({
      where: {
        idempotencyKey,
        status: { in: ['draft_created', 'published'] },
      },
      select: { id: true },
    })
    if (existingAttempt) {
      return { status: 'skipped', reason: 'idempotency_conflict' }
    }

    const factPack = buildSeoFactPack({
      candidate: input.candidate,
      products: input.products,
      demandSignals: input.demandSignals,
    })

    if (factPack.products.length === 0) {
      await prisma.seoContentGeneration.create({
        data: {
          runId: input.runId,
          clusterKey: input.candidate.clusterKey,
          status: 'skipped',
          candidateSnapshot: asJson(input.candidate),
          errors: asJson(['no_fact_pack_products']),
        },
      })
      return { status: 'skipped', reason: 'no_fact_pack_products' }
    }

    const factPackHash = sha256(JSON.stringify(factPack))
    const generation = await prisma.seoContentGeneration.create({
      data: {
        runId: input.runId,
        clusterKey: input.candidate.clusterKey,
        idempotencyKey,
        status: 'generating',
        candidateSnapshot: asJson(input.candidate),
        factPackHash,
      },
      select: { id: true },
    })

    let articleResult: Awaited<ReturnType<typeof seoOpenAi.generateStructuredArticle>>
    try {
      articleResult = await withTransientRetry(() => seoOpenAi.generateStructuredArticle(factPack))
    } catch (error) {
      await prisma.seoContentGeneration.update({
        where: { id: generation.id },
        data: {
          status: isTransientOpenAiError(error) ? 'failed_transient' : 'failed',
          errors: asJson([serializeError(error)]),
        },
      })
      return {
        status: 'skipped',
        reason: isTransientOpenAiError(error) ? 'openai_transient_error' : 'openai_generation_failed',
      }
    }

    const validation = validateGeneratedSeoArticle(articleResult.article, factPack)
    const duplicateCheck = findGeneratedConflict({
      candidate: input.candidate,
      article: articleResult.article,
      existingContent: input.existingContent,
      factPack,
    })

    if (duplicateCheck) {
      await prisma.seoContentGeneration.update({
        where: { id: generation.id },
        data: {
          status: duplicateCheck.includes('cannibalization') ? 'skipped_cannibalization' : 'skipped_duplicate',
          promptVersion: articleResult.promptVersion,
          schemaVersion: articleResult.schemaVersion,
          promptHash: articleResult.promptHash,
          openaiResponseId: articleResult.responseId,
          tokenUsage: asJson(articleResult.tokenUsage),
          errors: asJson([duplicateCheck]),
        },
      })
      return { status: 'skipped', reason: duplicateCheck }
    }

    if (validation.decision === 'reject') {
      await prisma.seoContentGeneration.update({
        where: { id: generation.id },
        data: {
          status: 'rejected_quality',
          promptVersion: articleResult.promptVersion,
          schemaVersion: articleResult.schemaVersion,
          promptHash: articleResult.promptHash,
          openaiResponseId: articleResult.responseId,
          tokenUsage: asJson(articleResult.tokenUsage),
          gateResults: asJson(validation),
          errors: asJson(validation.reasons),
        },
      })
      return { status: 'skipped', reason: 'quality_gate_rejected' }
    }

    const rendered = renderGeneratedSeoArticle(articleResult.article, factPack)
    const estimatedTextCost = estimateTextCost(articleResult.tokenUsage)

    if (input.mode === 'dry_run') {
      await prisma.seoContentGeneration.update({
        where: { id: generation.id },
        data: {
          status: 'validated_dry_run',
          promptVersion: articleResult.promptVersion,
          schemaVersion: articleResult.schemaVersion,
          promptHash: articleResult.promptHash,
          openaiResponseId: articleResult.responseId,
          tokenUsage: asJson(articleResult.tokenUsage),
          estimatedCostUsd: estimatedTextCost,
          gateResults: asJson(validation),
        },
      })

      return {
        status: 'dry_run_ok',
        estimatedCostUsd: estimatedTextCost,
        tokenUsage: {
          inputTokens: articleResult.tokenUsage.inputTokens,
          outputTokens: articleResult.tokenUsage.outputTokens,
        },
      }
    }

    let imageInfo: {
      assetId: string
      objectKey: string | null
      publicUrl: string
      responseId: string | null
    } | null = null

    if (shouldGenerateImages()) {
      try {
        imageInfo = await seoImage.generateCoverImage({
          prompt: articleResult.article.imagePrompt,
          ownerId: process.env['SEO_CONTENT_AUTHOR_ID']?.trim() || 'system-seo',
        })
      } catch (error) {
        await prisma.seoContentGeneration.update({
          where: { id: generation.id },
          data: {
            errors: asJson([serializeError(error)]),
          },
        })
      }
    }

    const slug = await resolveUniqueBlogSlug(articleResult.article.title)
    const authorId = process.env['SEO_CONTENT_AUTHOR_ID']?.trim() || 'system-seo'
    let post: { id: string; slug: string; title: string; clusterKey: string | null; status: string }

    try {
      post = await prisma.blogPost.create({
        data: {
          slug,
          title: articleResult.article.title,
          summary: articleResult.article.summary,
          body: rendered.body,
          coverUrl: imageInfo?.publicUrl ?? factPack.products[0]?.imageUrl ?? null,
          status: 'draft',
          authorId,
          rootTopic: input.candidate.rootTopic,
          subIntent: input.candidate.subIntent,
          intentType: input.candidate.intentType,
          targetKeyword: input.candidate.targetKeyword,
          supportingKeywords: asJson(input.candidate.supportingKeywords),
          linkedCategoryIds: asJson(rendered.linkedCategoryIds),
          linkedProductIds: asJson(rendered.linkedProductIds),
          clusterKey: input.candidate.clusterKey,
          qualityScore: input.candidate.qualityScore,
          generatedBy: SEO_GENERATOR_ID,
          generatedAt: input.now,
          generationMetadata: asJson({
            seoRunId: input.runId,
            seoGenerationId: generation.id,
            promptVersion: articleResult.promptVersion,
            schemaVersion: articleResult.schemaVersion,
            promptHash: articleResult.promptHash,
            factPackHash,
            responseId: articleResult.responseId,
            imageResponseId: imageInfo?.responseId ?? null,
            tokenUsage: articleResult.tokenUsage,
            estimatedTextCostUsd: estimatedTextCost,
            metaDescription: articleResult.article.metaDescription,
            headingSet: rendered.headingSet,
            gateResults: validation,
          }),
        },
        select: { id: true, slug: true, title: true, clusterKey: true, status: true },
      })
    } catch (error) {
      await cleanupImageArtifact(imageInfo?.assetId ?? null, imageInfo?.objectKey ?? null)
      await prisma.seoContentGeneration.update({
        where: { id: generation.id },
        data: {
          status: 'failed_draft_create',
          promptVersion: articleResult.promptVersion,
          schemaVersion: articleResult.schemaVersion,
          promptHash: articleResult.promptHash,
          openaiResponseId: articleResult.responseId,
          tokenUsage: asJson(articleResult.tokenUsage),
          estimatedCostUsd: estimatedTextCost + (imageInfo ? estimateImageCost() : 0),
          gateResults: asJson(validation),
          errors: asJson([serializeError(error)]),
        },
      })
      return { status: 'skipped', reason: 'draft_create_failed' }
    }

    let published = false
    let publishAcceptanceFailed = false

    const finalMode = input.mode
    if (finalMode === 'publish') {
      try {
        await prisma.$transaction(async (tx) => {
          const latest = await tx.blogPost.findFirst({
            where: {
              OR: [
                { clusterKey: input.candidate.clusterKey },
                {
                  targetKeyword: {
                    equals: input.candidate.targetKeyword,
                    mode: 'insensitive',
                  },
                },
              ],
              NOT: { id: post.id },
            },
            select: { id: true },
          })

          if (latest) {
            throw new ConflictError('Ayni cluster veya hedef kelime icin icerik zaten mevcut.')
          }

          await tx.blogPost.update({
            where: { id: post.id },
            data: {
              status: 'published',
              publishedAt: input.now,
            },
          })
        })
        published = true
      } catch (error) {
        await prisma.seoContentGeneration.update({
          where: { id: generation.id },
          data: {
            status: 'failed_publish',
            blogPostId: post.id,
            errors: asJson([serializeError(error)]),
          },
        })
        return { status: 'skipped', reason: 'publish_failed' }
      }

      const acceptance = await prisma.blogPost.findUnique({
        where: { id: post.id },
        select: { status: true, slug: true, title: true },
      })
      publishAcceptanceFailed = !acceptance || acceptance.status !== 'published'
    }

    const estimatedImageCost = imageInfo ? estimateImageCost() : 0
    const totalCost = estimatedTextCost + estimatedImageCost

    await prisma.seoContentGeneration.update({
      where: { id: generation.id },
      data: {
        status: published ? 'published' : 'draft_created',
        promptVersion: articleResult.promptVersion,
        schemaVersion: articleResult.schemaVersion,
        promptHash: articleResult.promptHash,
        openaiResponseId: articleResult.responseId,
        openaiImageResponseId: imageInfo?.responseId ?? null,
        tokenUsage: asJson(articleResult.tokenUsage),
        estimatedCostUsd: totalCost,
        imageAssetId: imageInfo?.assetId ?? null,
        imageObjectKey: imageInfo?.objectKey ?? null,
        gateResults: asJson(validation),
        blogPostId: post.id,
      },
    })

    return {
      status: 'ok',
      post: {
        id: post.id,
        slug: post.slug,
        title: post.title,
        clusterKey: post.clusterKey ?? input.candidate.clusterKey,
      },
      published,
      estimatedCostUsd: totalCost,
      tokenUsage: {
        inputTokens: articleResult.tokenUsage.inputTokens,
        outputTokens: articleResult.tokenUsage.outputTokens,
      },
      imageCount: imageInfo ? 1 : 0,
      publishAcceptanceFailed,
    }
  }

  async function finalizeRun(
    runId: string,
    status: 'completed' | 'rolled_back',
    result: Omit<SeoContentAutomationResult, 'runId' | 'mode' | 'status'>,
  ) {
    await prisma.seoContentRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        totals: asJson({
          evaluatedCandidates: result.evaluatedCandidates,
          approvedCandidates: result.approvedCandidates,
          draftedCount: result.draftedPosts.length,
          publishedCount: result.publishedPosts.length,
          skippedReasons: result.skippedReasons,
          totals: result.totals,
        }),
      },
    })
  }

  async function rollbackPublishedPosts(runId: string) {
    const generations = await prisma.seoContentGeneration.findMany({
      where: { runId, status: 'published', blogPostId: { not: null } },
      select: { id: true, blogPostId: true },
    })
    const postIds = generations.map((item) => item.blogPostId).filter(Boolean) as string[]
    if (postIds.length > 0) {
      await prisma.blogPost.updateMany({
        where: { id: { in: postIds } },
        data: {
          status: 'draft',
          publishedAt: null,
        },
      })
    }

    if (generations.length > 0) {
      await prisma.seoContentGeneration.updateMany({
        where: { id: { in: generations.map((item) => item.id) } },
        data: { status: 'rolled_back' },
      })
    }
  }

  async function recordSkippedEvaluations(
    runId: string,
    evaluations: Array<{
      candidate: SeoTopicCandidate
      approved: boolean
      reasons: string[]
      score: number
    }>,
  ) {
    if (evaluations.length === 0) return
    await prisma.seoContentGeneration.createMany({
      data: evaluations.map((item) => ({
        runId,
        clusterKey: item.candidate.clusterKey,
        status: 'skipped',
        candidateSnapshot: asJson(item.candidate),
        gateResults: asJson({ reasons: item.reasons, score: item.score }),
      })),
    })
  }

  async function ensureNoActiveRun(ignoreRunId?: string) {
    const activeRun = await prisma.seoContentRun.findFirst({
      where: {
        status: { in: [...ACTIVE_RUN_STATUSES] },
        ...(ignoreRunId ? { NOT: { id: ignoreRunId } } : {}),
      },
      select: { id: true },
    })
    if (activeRun) {
      throw new ConflictError('SEO otomasyonu icin zaten aktif bir run calisiyor.')
    }
  }

  async function budgetsExceeded(now: Date, accumulatedRunCostUsd: number) {
    const runBudgetUsd = getNumberEnv('SEO_CONTENT_OPENAI_RUN_BUDGET_USD', 0)
    if (runBudgetUsd > 0 && accumulatedRunCostUsd >= runBudgetUsd) return true

    const dailyBudgetUsd = getNumberEnv('SEO_CONTENT_OPENAI_DAILY_BUDGET_USD', 0)
    if (dailyBudgetUsd <= 0) return false

    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const rows = await prisma.seoContentGeneration.findMany({
      where: { createdAt: { gte: startOfDay }, estimatedCostUsd: { not: null } },
      select: { estimatedCostUsd: true },
    })
    const spentToday = rows.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0)
    return spentToday >= dailyBudgetUsd
  }

  async function cleanupImageArtifact(assetId: string | null, objectKey: string | null) {
    try {
      if (objectKey) await deleteObject(objectKey)
    } catch (error) {
      console.warn('[seo-content] image cleanup failed:', error)
    }

    if (assetId) {
      try {
        await prisma.mediaAsset.delete({ where: { id: assetId } })
      } catch (error) {
        console.warn('[seo-content] media asset cleanup failed:', error)
      }
    }
  }

  async function resolveUniqueBlogSlug(title: string): Promise<string> {
    const baseSlug = normalizeSlug(title) || 'rehber'
    for (let suffix = 1; suffix < 10_000; suffix += 1) {
      const candidate = suffix === 1 ? baseSlug : `${baseSlug.slice(0, 74)}-${suffix}`
      const existing = await prisma.blogPost.findUnique({ where: { slug: candidate } })
      if (!existing) return candidate
    }
    throw new Error('SEO blog slug could not be generated.')
  }

  return {
    createRun,
    runWeeklyTopicalAuthorityAutomation,
  }
}

function evaluateCandidate(
  candidate: SeoTopicCandidate,
  context: {
    categories: Array<{ id: string; slug: string; name: string; parentId?: string | null }>
    products: SeoProductSignal[]
    existingContent: ExistingSeoContentRecord[]
  },
): {
  candidate: SeoTopicCandidate
  approved: boolean
  reasons: string[]
  score: number
} {
  const base = evaluateSeoCandidate(candidate)
  const reasons = [...base.reasons]
  const normalizedTarget = normalizeSeoText(candidate.targetKeyword)
  const categoryNames = context.categories.map((category) => normalizeSeoText(category.name))
  const categorySlugs = context.categories.map((category) => normalizeSeoText(category.slug.replace(/-/g, ' ')))
  const productNames = context.products.map((product) => normalizeSeoText(product.name))

  if (normalizedTarget.split(/\s+/).length < 2) {
    reasons.push('head_term_risk')
  }

  if (candidate.intentType === 'product_search') {
    reasons.push('commercial_intent_reserved')
  }

  if (categoryNames.includes(normalizedTarget) || categorySlugs.includes(normalizedTarget)) {
    reasons.push('category_cannibalization_risk')
  }

  if (productNames.includes(normalizedTarget)) {
    reasons.push('product_cannibalization_risk')
  }

  if (
    context.existingContent.some(
      (item) =>
        normalizeSeoText(item.title) === normalizedTarget ||
        normalizeSeoText(item.targetKeyword ?? '') === normalizedTarget,
    )
  ) {
    reasons.push('duplicate_target_keyword')
  }

  const uniqueReasons = [...new Set(reasons)]
  const approved = base.approved && uniqueReasons.length === 0
  return {
    candidate,
    approved,
    reasons: uniqueReasons,
    score: candidate.qualityScore,
  }
}

function findGeneratedConflict(input: {
  candidate: SeoTopicCandidate
  article: { title: string; metaDescription: string; sections: Array<{ heading: string; paragraphs: string[] }> }
  existingContent: ExistingSeoContentRecord[]
  factPack: SeoFactPack
}): string | null {
  const normalizedTitle = normalizeSeoText(input.article.title)
  const normalizedTarget = normalizeSeoText(input.candidate.targetKeyword)
  const categoryName = normalizeSeoText(input.factPack.category.name)

  if (normalizedTitle === categoryName || normalizedTarget === categoryName) {
    return 'skipped_cannibalization_risk'
  }

  const generatedSignature = buildSeoBodySignature({
    title: input.article.title,
    metaDescription: input.article.metaDescription,
    headings: input.article.sections.map((section) => section.heading),
    bodyText: input.article.sections.flatMap((section) => section.paragraphs).join(' '),
  })

  for (const existing of input.existingContent) {
    const existingSignature = getExistingSignature(existing)
    const score = similarityScore(generatedSignature, existingSignature)
    const existingTarget = normalizeSeoText(existing.targetKeyword ?? '')

    if (
      normalizedTitle === normalizeSeoText(existing.title) ||
      normalizedTarget === existingTarget ||
      score >= 0.72
    ) {
      return existingTarget === categoryName ? 'skipped_cannibalization_risk' : 'skipped_duplicate_risk'
    }
  }

  return null
}

function getExistingSignature(existing: ExistingSeoContentRecord): string[] {
  const metaDescription =
    existing.generationMetadata &&
    typeof existing.generationMetadata === 'object' &&
    'metaDescription' in (existing.generationMetadata as Record<string, unknown>)
      ? ((existing.generationMetadata as Record<string, unknown>)['metaDescription'] as string | null)
      : null

  const headingSet =
    existing.generationMetadata &&
    typeof existing.generationMetadata === 'object' &&
    Array.isArray((existing.generationMetadata as Record<string, unknown>)['headingSet'])
      ? (((existing.generationMetadata as Record<string, unknown>)['headingSet'] as string[]) ?? [])
      : []

  return buildSeoBodySignature({
    title: existing.title,
    metaDescription,
    headings: headingSet,
    bodyText: existing.body,
  })
}

function normalizeMode(options: SeoContentAutomationOptions): SeoContentRunMode {
  if (options.dryRun) return 'dry_run'
  if (options.mode) return options.mode
  return process.env['SEO_CONTENT_AUTO_PUBLISH_ENABLED'] === 'true' ? 'publish' : 'draft'
}

function emptyResult(
  mode: SeoContentRunMode,
  status: SeoContentAutomationResult['status'],
): SeoContentAutomationResult {
  return {
    runId: null,
    mode,
    status,
    evaluatedCandidates: 0,
    approvedCandidates: 0,
    draftedPosts: [],
    publishedPosts: [],
    skippedReasons: {},
    totals: zeroTotals(),
  }
}

function summarizeSkippedReasons(
  evaluations: Array<{ approved: boolean; reasons: string[] }>,
): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const evaluation of evaluations) {
    if (evaluation.approved) continue
    for (const reason of evaluation.reasons) {
      summary[reason] = (summary[reason] ?? 0) + 1
    }
  }
  return summary
}

function zeroTotals() {
  return {
    estimatedCostUsd: 0,
    textInputTokens: 0,
    textOutputTokens: 0,
    imageCount: 0,
  }
}

function buildIdempotencyKey(clusterKey: string) {
  return `${clusterKey}:${SEO_OPENAI_PROMPT_VERSION}:${SEO_OPENAI_SCHEMA_VERSION}`
}

async function withTransientRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isTransientOpenAiError(error) || attempt === maxAttempts) break
      await sleep(750 * attempt)
    }
  }
  throw lastError
}

function shouldGenerateImages() {
  return process.env['SEO_CONTENT_GENERATE_IMAGES_ENABLED'] === 'true'
}

function estimateTextCost(tokenUsage: {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}) {
  const inputRate = getNumberEnv('OPENAI_SEO_TEXT_INPUT_COST_PER_1M_USD', 0)
  const cachedRate = getNumberEnv('OPENAI_SEO_TEXT_CACHED_INPUT_COST_PER_1M_USD', 0)
  const outputRate = getNumberEnv('OPENAI_SEO_TEXT_OUTPUT_COST_PER_1M_USD', 0)
  const uncachedInput = Math.max(0, tokenUsage.inputTokens - tokenUsage.cachedTokens)
  return (
    (uncachedInput / 1_000_000) * inputRate +
    (tokenUsage.cachedTokens / 1_000_000) * cachedRate +
    (tokenUsage.outputTokens / 1_000_000) * outputRate
  )
}

function estimateImageCost() {
  return getNumberEnv('OPENAI_SEO_IMAGE_COST_USD', 0)
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }
  return { message: String(error) }
}

function decimalToNumber(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    const maybeDecimal = value as { toNumber: () => number }
    return maybeDecimal.toNumber()
  }
  return null
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function getNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function daysAgo(from: Date, days: number): Date {
  const value = new Date(from)
  value.setDate(value.getDate() - days)
  return value
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
