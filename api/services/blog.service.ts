/**
 * Blog service — editorial content management.
 *
 * Blog posts are admin-managed content that supports product/category discovery.
 * Published posts are publicly indexable. Drafts are admin-only.
 *
 * SEO note: slug changes are a breaking SEO event — avoid after publish.
 * See docs/04-seo/seo-url-slug-rules.md.
 */
import type { PrismaClient } from '@prisma/client'
import { createBlogRepository } from '../repositories/blog.repository'
import { NotFoundError, ValidationError } from '../lib/errors'

export interface CreateBlogPostInput {
  slug: string
  title: string
  summary?: string
  body: string
  coverUrl?: string
  authorId: string
}

export interface UpdateBlogPostInput {
  title?: string
  summary?: string
  body?: string
  coverUrl?: string
  /** SEO warning: changing slug after publish creates a broken URL. */
  slug?: string
}

export interface BlogPostListItem {
  id: string
  slug: string
  title: string
  summary: string | null
  coverUrl: string | null
  publishedAt: Date | null
}

export interface BlogPostListResult {
  posts: BlogPostListItem[]
  total: number
  page: number
  limit: number
}

export function createBlogService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps
  const blogRepo = createBlogRepository(prisma)

  async function listPublished(params: {
    page?: number
    limit?: number
  }): Promise<BlogPostListResult> {
    const page = params.page ?? 1
    const limit = params.limit ?? 12
    const skip = (page - 1) * limit

    const [posts, total] = await Promise.all([
      blogRepo.listPublished({ skip, take: limit }),
      blogRepo.countPublished(),
    ])

    return { posts, total, page, limit }
  }

  async function getPublishedBySlug(slug: string) {
    const post = await blogRepo.findPublishedBySlug(slug)
    if (!post) throw new NotFoundError('BlogPost', slug)
    return post
  }

  async function createPost(input: CreateBlogPostInput) {
    const slugTaken = await blogRepo.findBySlug(input.slug)
    if (slugTaken) {
      throw new ValidationError(`Bu blog adresi zaten kullanımda: ${input.slug}`)
    }

    return blogRepo.create(input)
  }

  async function updatePost(id: string, input: UpdateBlogPostInput) {
    const post = await blogRepo.findById(id)
    if (!post) throw new NotFoundError('BlogPost', id)

    if (input.slug && input.slug !== post.slug) {
      const slugTaken = await blogRepo.findBySlug(input.slug)
      if (slugTaken) {
        throw new ValidationError(`Bu blog adresi zaten kullanımda: ${input.slug}`)
      }
      if (post.status === 'published') {
        // Slug change on published post is a breaking SEO change — allowed but warned
        console.warn(
          `[blog.service] SEO UYARI: Yayındaki blog yazısının slug'ı değiştiriliyor. ID=${id}, eski=${post.slug}, yeni=${input.slug}`,
        )
      }
    }

    return blogRepo.update(id, input)
  }

  async function publishPost(id: string) {
    const post = await blogRepo.findById(id)
    if (!post) throw new NotFoundError('BlogPost', id)
    if (post.status === 'published') {
      throw new ValidationError('Bu yazı zaten yayında.')
    }
    return blogRepo.publish(id)
  }

  async function unpublishPost(id: string) {
    const post = await blogRepo.findById(id)
    if (!post) throw new NotFoundError('BlogPost', id)
    return blogRepo.unpublish(id)
  }

  async function deletePost(id: string) {
    const post = await blogRepo.findById(id)
    if (!post) throw new NotFoundError('BlogPost', id)
    if (post.status === 'published') {
      throw new ValidationError(
        'Yayındaki blog yazısı silinemez. Önce yayından kaldırın.',
      )
    }
    return blogRepo.delete(id)
  }

  async function listForAdmin(params: {
    page?: number
    limit?: number
    status?: 'draft' | 'published' | 'archived'
  }) {
    const page = params.page ?? 1
    const limit = params.limit ?? 20
    const skip = (page - 1) * limit

    return blogRepo.listForAdmin({
      skip,
      take: limit,
      status: params.status as never,
    })
  }

  return {
    listPublished,
    getPublishedBySlug,
    createPost,
    updatePost,
    publishPost,
    unpublishPost,
    deletePost,
    listForAdmin,
  }
}
