import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarDays, Clock } from 'lucide-react'
import { createBlogService } from '@hanuja/api/services/blog.service'
import { NotFoundError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { sanitizeBlogHtml } from '@hanuja/api/lib/sanitize-blog-html'
import { buildArticleStructuredData, buildBlogPostMetadata, JsonLd } from '@hanuja/seo'
import { Breadcrumb, isManagedMediaProxyUrl, normalizeMediaDisplayUrl } from '@hanuja/ui'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

async function getBlogPost(slug: string) {
  try {
    const service = createBlogService({ prisma: createPrismaForRoute() })
    return await service.getPublishedBySlug(slug)
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}

function formatDate(date: Date | null) {
  if (!date) return ''
  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getBlogPost(slug)
  if (!post) return { title: 'Blog yazisi bulunamadi' }

  return buildBlogPostMetadata({
    title: post.title,
    slug,
    ...(post.summary ? { excerpt: post.summary } : {}),
    ...(post.coverUrl ? { imageUrl: post.coverUrl } : {}),
  })
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = await getBlogPost(slug)

  if (!post) notFound()

  const breadcrumbItems = [
    { label: 'Anasayfa', href: '/' },
    { label: 'Blog', href: '/blog' },
    { label: post.title },
  ]

  const coverUrl = post.coverUrl ? normalizeMediaDisplayUrl(post.coverUrl) : null
  const sanitizedBody = sanitizeBlogHtml(post.body)
  const articleJsonLd = buildArticleStructuredData({
    title: post.title,
    slug,
    excerpt: post.summary ?? `${post.title} - Hanuja Blog.`,
    publishedAt: post.publishedAt?.toISOString() ?? new Date().toISOString(),
    ...(post.coverUrl ? { imageUrl: post.coverUrl } : {}),
  })

  const wordCount = sanitizedBody.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  const readMinutes = Math.max(1, Math.round(wordCount / 200))

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <JsonLd data={articleJsonLd} />
      <Breadcrumb items={breadcrumbItems} className="mb-8" />

      <Link
        href="/blog"
        className="mb-6 inline-flex items-center gap-1.5 text-sm transition-colors hover:text-[var(--color-accent)]"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        Blog'a Don
      </Link>

      <article>
        <header className="mb-10">
          <h1
            className="text-3xl font-normal leading-snug md:text-4xl"
            style={{ fontFamily: 'var(--font-display)', color: '#3d3529' }}
          >
            {post.title}
          </h1>

          <div
            className="mt-4 flex items-center gap-4 text-sm"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            {post.publishedAt ? (
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                {formatDate(post.publishedAt)}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {readMinutes} dk okuma
            </span>
          </div>

          {coverUrl ? (
            <div className="relative mt-8 aspect-video w-full overflow-hidden rounded-2xl">
              <Image
                src={coverUrl}
                alt={post.title}
                fill
                priority
                sizes="(max-width: 768px) 100vw, 800px"
                className="object-cover"
                unoptimized={isManagedMediaProxyUrl(coverUrl)}
              />
            </div>
          ) : (
            <div
              className="mt-8 flex aspect-video w-full items-center justify-center rounded-2xl text-sm"
              style={{
                backgroundColor: 'var(--color-muted)',
                color: 'var(--color-muted-fg)',
                border: '1px solid var(--color-border)',
              }}
            >
              Makale Gorseli
            </div>
          )}
        </header>

        <div
          className="prose prose-slate max-w-none text-base leading-relaxed"
          style={{ color: 'var(--color-primary)' }}
        >
          {sanitizedBody ? (
            <div
              style={{ color: 'var(--color-muted-fg)' }}
              dangerouslySetInnerHTML={{ __html: sanitizedBody }}
            />
          ) : (
            <p style={{ color: 'var(--color-muted-fg)' }}>Icerik henuz eklenmedi.</p>
          )}
        </div>
      </article>
    </div>
  )
}
