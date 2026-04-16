import type { PrismaClient, BlogPostStatus } from '@prisma/client'

export function createBlogRepository(prisma: PrismaClient) {
  return {
    findBySlug(slug: string) {
      return prisma.blogPost.findUnique({ where: { slug } })
    },

    findPublishedBySlug(slug: string) {
      return prisma.blogPost.findUnique({
        where: { slug, status: 'published' },
      })
    },

    findById(id: string) {
      return prisma.blogPost.findUnique({ where: { id } })
    },

    listPublished(params: {
      skip?: number
      take?: number
    }) {
      return prisma.blogPost.findMany({
        where: { status: 'published' },
        orderBy: { publishedAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 12,
        select: {
          id: true,
          slug: true,
          title: true,
          summary: true,
          coverUrl: true,
          publishedAt: true,
        },
      })
    },

    countPublished() {
      return prisma.blogPost.count({ where: { status: 'published' } })
    },

    listForAdmin(params: {
      skip?: number
      take?: number
      status?: BlogPostStatus
    }) {
      return prisma.blogPost.findMany({
        ...(params.status !== undefined ? { where: { status: params.status } } : {}),
        orderBy: { updatedAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 20,
      })
    },

    create(data: {
      slug: string
      title: string
      summary?: string
      body: string
      coverUrl?: string
      authorId: string
    }) {
      return prisma.blogPost.create({ data })
    },

    update(
      id: string,
      data: {
        title?: string
        summary?: string
        body?: string
        coverUrl?: string
        slug?: string
      },
    ) {
      return prisma.blogPost.update({ where: { id }, data })
    },

    publish(id: string) {
      return prisma.blogPost.update({
        where: { id },
        data: { status: 'published', publishedAt: new Date() },
      })
    },

    unpublish(id: string) {
      return prisma.blogPost.update({
        where: { id },
        data: { status: 'draft', publishedAt: null },
      })
    },

    delete(id: string) {
      return prisma.blogPost.delete({ where: { id } })
    },
  }
}

export type BlogRepository = ReturnType<typeof createBlogRepository>
