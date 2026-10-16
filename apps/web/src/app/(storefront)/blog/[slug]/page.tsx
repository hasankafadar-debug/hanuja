import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarDays, Clock } from 'lucide-react'
import { createBlogService } from '@hanuja/api/services/blog.service'
import { NotFoundError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { sanitizeBlogHtml } from '@hanuja/api/lib/sanitize-blog-html'
import { getConfiguredMediaBaseUrl, normalizeManagedMediaUrl } from '@hanuja/api/lib/media-url'
import { DEFAULT_MEDIA_HOSTNAME } from '@hanuja/api/lib/platform-info'
import {
  buildArticleStructuredData,
  buildBlogPostMetadata,
  buildBreadcrumbStructuredData,
  JsonLd,
} from '@hanuja/seo'
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

function normalizeBlogSocialImageUrl(sourceUrl: string) {
  const publicBaseUrl = getConfiguredMediaBaseUrl() || `https://${DEFAULT_MEDIA_HOSTNAME}`
  return normalizeManagedMediaUrl(sourceUrl, publicBaseUrl)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getBlogPost(slug)
  if (!post) return { title: 'Blog yazisi bulunamadi' }
  const coverUrl = post.coverUrl ? normalizeBlogSocialImageUrl(post.coverUrl) : null

  return buildBlogPostMetadata({
    title: post.title,
    slug,
    authorName: 'Hanuja Editörü',
    ...(post.publishedAt ? { publishedAt: post.publishedAt.toISOString() } : {}),
    ...(post.summary ? { excerpt: post.summary } : {}),
    ...(coverUrl ? { imageUrl: coverUrl } : {}),
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
  const socialCoverUrl = post.coverUrl ? normalizeBlogSocialImageUrl(post.coverUrl) : null
  const sanitizedBody = sanitizeBlogHtml(post.body)
  const articleJsonLd = buildArticleStructuredData({
    title: post.title,
    slug,
    excerpt: post.summary ?? `${post.title} - Hanuja Blog.`,
    ...(post.publishedAt ? { publishedAt: post.publishedAt.toISOString() } : {}),
    modifiedAt: post.updatedAt.toISOString(),
    ...(socialCoverUrl ? { imageUrl: socialCoverUrl } : {}),
  })

  const wordCount = sanitizedBody
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length
  const readMinutes = Math.max(1, Math.round(wordCount / 200))

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <JsonLd data={articleJsonLd} />
      <JsonLd
        data={buildBreadcrumbStructuredData([
          { name: 'Anasayfa', url: '/' },
          { name: 'Blog', url: '/blog' },
          { name: post.title, url: `/blog/${post.slug}` },
        ])}
      />
      <Breadcrumb items={breadcrumbItems} className="mb-8" />

      <Link
        href="/blog"
        className="mb-6 inline-flex items-center gap-1.5 text-sm transition-colors hover:text-[var(--color-accent)]"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        Blog'a Dön
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
            className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            <Link href="/blog" rel="author" className="underline">
              Hanuja Editörü
            </Link>
            {post.publishedAt ? (
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                <time dateTime={post.publishedAt.toISOString()}>
                  {formatDate(post.publishedAt)}
                </time>
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {readMinutes} dk okuma
            </span>
            {post.updatedAt.getTime() >
              (post.publishedAt?.getTime() ?? post.updatedAt.getTime()) && (
              <span>
                Güncelleme:{' '}
                <time dateTime={post.updatedAt.toISOString()}>{formatDate(post.updatedAt)}</time>
              </span>
            )}
          </div>

          {post.summary && (
            <p className="mt-6 text-lg leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
              {post.summary}
            </p>
          )}

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
      <nav
        aria-label="İlgili sayfalar"
        className="mt-10 flex flex-wrap gap-4 border-t pt-6 text-sm"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <Link href="/blog" className="underline">
          Diğer tasarım ve yaşam rehberleri
        </Link>
        <Link href="/hakkimizda" className="underline">
          Hanuja hakkında
        </Link>
      </nav>
    </div>
  )
}
