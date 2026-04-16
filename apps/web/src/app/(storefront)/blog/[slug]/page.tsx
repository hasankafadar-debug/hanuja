import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Breadcrumb } from '@hanuja/ui'
import { CalendarDays, Clock, ArrowLeft } from 'lucide-react'
import { buildBlogPostMetadata, buildArticleStructuredData, JsonLd } from '@hanuja/seo'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createBlogService } from '@hanuja/api/services/blog.service'
import { NotFoundError } from '@hanuja/api/lib/errors'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

async function getBlogPost(slug: string) {
  try {
    const svc = createBlogService({ prisma: createPrismaForRoute() })
    return await svc.getPublishedBySlug(slug)
  } catch (err) {
    if (err instanceof NotFoundError) return null
    throw err
  }
}

function formatDate(date: Date | null) {
  if (!date) return ''
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getBlogPost(slug)
  if (!post) return { title: 'Blog yazısı bulunamadı' }
  return buildBlogPostMetadata({
    title: post.title,
    slug,
    ...(post.summary !== null ? { excerpt: post.summary } : {}),
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

  const articleJsonLd = buildArticleStructuredData({
    title: post.title,
    slug,
    excerpt: post.summary ?? `${post.title} — Hanuja Blog.`,
    publishedAt: post.publishedAt?.toISOString() ?? new Date().toISOString(),
  })

  // Estimate read time (~200 words per minute)
  const wordCount = (post.body ?? '').split(/\s+/).length
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
        Blog&apos;a Dön
      </Link>

      <article>
        <header className="mb-10">
          <h1
            className="text-3xl font-bold leading-snug md:text-4xl"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
          >
            {post.title}
          </h1>
          <div className="mt-4 flex items-center gap-4 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {post.publishedAt && (
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                {formatDate(post.publishedAt)}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {readMinutes} dk okuma
            </span>
          </div>

          {post.coverUrl ? (
            <div
              className="mt-8 aspect-video w-full rounded-2xl overflow-hidden"
              style={{
                backgroundImage: `url(${post.coverUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          ) : (
            <div
              className="mt-8 aspect-video w-full rounded-2xl flex items-center justify-center text-sm"
              style={{
                backgroundColor: 'var(--color-muted)',
                color: 'var(--color-muted-fg)',
                border: '1px solid var(--color-border)',
              }}
            >
              Makale Görseli
            </div>
          )}
        </header>

        {/* Article body */}
        <div
          className="prose prose-slate max-w-none text-base leading-relaxed"
          style={{ color: 'var(--color-primary)' }}
        >
          {post.body ? (
            <div
              style={{ color: 'var(--color-muted-fg)', whiteSpace: 'pre-wrap' }}
              dangerouslySetInnerHTML={{ __html: post.body }}
            />
          ) : (
            <p style={{ color: 'var(--color-muted-fg)' }}>İçerik henüz eklenmedi.</p>
          )}
        </div>
      </article>
    </div>
  )
}
