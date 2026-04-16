/**
 * Blog route handlers.
 *
 * Public: GET list, GET single by slug
 * Admin only: POST create, PUT update, POST publish/unpublish, DELETE
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, created, handleError } from '../lib/response'
import { createBlogService } from '../services/blog.service'
import { createPrismaForRoute } from '../lib/prisma'

function getBlogService() {
  return createBlogService({ prisma: createPrismaForRoute() })
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
})

// GET /api/blog — public
export async function listPublishedPosts(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const params = listQuerySchema.parse(Object.fromEntries(url.searchParams))
    const result = await getBlogService().listPublished(params)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/blog/:slug — public
export async function getPostBySlug(
  _req: NextRequest,
  params: { slug: string },
) {
  try {
    const post = await getBlogService().getPublishedBySlug(params.slug)
    return ok(post)
  } catch (err) {
    return handleError(err)
  }
}

const createPostSchema = z.object({
  slug: z.string().min(3).max(120).regex(/^[a-z0-9-]+$/, 'Slug yalnızca küçük harf, rakam ve tire içerebilir.'),
  title: z.string().min(5).max(200),
  summary: z.string().max(500).optional(),
  body: z.string().min(50),
  coverUrl: z.string().url().optional(),
})

// POST /api/admin/blog — admin only
export async function createPost(req: NextRequest, authorId: string) {
  try {
    const body = await req.json()
    const input = createPostSchema.parse(body)
    const post = await getBlogService().createPost({ ...input, authorId })
    return created(post)
  } catch (err) {
    return handleError(err)
  }
}

const updatePostSchema = z.object({
  slug: z.string().min(3).max(120).regex(/^[a-z0-9-]+$/).optional(),
  title: z.string().min(5).max(200).optional(),
  summary: z.string().max(500).optional(),
  body: z.string().min(50).optional(),
  coverUrl: z.string().url().optional(),
})

// PUT /api/admin/blog/:id — admin only
export async function updatePost(
  req: NextRequest,
  params: { id: string },
) {
  try {
    const body = await req.json()
    const input = updatePostSchema.parse(body)
    const post = await getBlogService().updatePost(params.id, input)
    return ok(post)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/blog/:id/publish — admin only
export async function publishPost(
  _req: NextRequest,
  params: { id: string },
) {
  try {
    const post = await getBlogService().publishPost(params.id)
    return ok(post)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/blog/:id/unpublish — admin only
export async function unpublishPost(
  _req: NextRequest,
  params: { id: string },
) {
  try {
    const post = await getBlogService().unpublishPost(params.id)
    return ok(post)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/admin/blog/:id — admin only
export async function deletePost(
  _req: NextRequest,
  params: { id: string },
) {
  try {
    await getBlogService().deletePost(params.id)
    return ok({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/admin/blog — admin list (all statuses)
export async function listPostsForAdmin(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') ?? '1', 10)
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10)
    const status = url.searchParams.get('status') as 'draft' | 'published' | undefined

    const posts = await getBlogService().listForAdmin({ page, limit, status })
    return ok({ posts, page, limit })
  } catch (err) {
    return handleError(err)
  }
}
