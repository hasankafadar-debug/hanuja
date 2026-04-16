import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, Clock } from 'lucide-react'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createBlogService } from '@hanuja/api/services/blog.service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Blog & İlham',
  description: 'Ev dekorasyonu, tasarım trendleri ve yaşam alanı fikirleri için Hanuja Blog.',
}

const CATEGORY_COLORS: Record<string, string> = {
  Dekorasyon: 'var(--color-accent)',
  Malzeme: '#8b5cf6',
  'Ev Ofisi': '#0ea5e9',
  Trend: '#f59e0b',
  'Yatak Odası': '#10b981',
  Mutfak: '#ef4444',
}

function formatDate(date: Date | null) {
  if (!date) return ''
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function BlogListPage() {
  const svc = createBlogService({ prisma: createPrismaForRoute() })
  const { posts } = await svc.listPublished({ page: 1, limit: 12 })

  if (posts.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <h1
          className="text-3xl font-bold mb-6"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
        >
          Blog & İlham
        </h1>
        <p style={{ color: 'var(--color-muted-fg)' }}>Henüz yayınlanmış blog yazısı bulunmuyor.</p>
      </div>
    )
  }

  const [featured, ...rest] = posts

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-10">
        <h1
          className="text-3xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
        >
          Blog & İlham
        </h1>
        <p className="mt-2 text-base" style={{ color: 'var(--color-muted-fg)' }}>
          Yaşam alanlarınız için fikirler, trendler ve uzman tavsiyeleri.
        </p>
      </div>

      {/* Featured post */}
      {featured && (
        <Link href={`/blog/${featured.slug}`} className="group block">
          <div
            className="relative mb-10 overflow-hidden rounded-2xl p-8 md:p-12 transition-transform group-hover:scale-[1.005]"
            style={{
              backgroundColor: featured.coverUrl ? undefined : 'var(--color-primary)',
              backgroundImage: featured.coverUrl ? `url(${featured.coverUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              color: 'white',
            }}
          >
            <div
              className="absolute inset-0 rounded-2xl"
              style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
            />
            <div className="relative">
              <h2
                className="text-2xl font-bold md:text-3xl"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {featured.title}
              </h2>
              {featured.summary && (
                <p className="mt-3 max-w-xl text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  {featured.summary}
                </p>
              )}
              {featured.publishedAt && (
                <div className="mt-6 flex items-center gap-4 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(featured.publishedAt)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </Link>
      )}

      {/* Post grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {rest.map((post) => (
          <Link key={post.slug} href={`/blog/${post.slug}`} className="group">
            <article
              className="h-full rounded-xl border p-6 transition-shadow hover:shadow-md"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
            >
              {post.coverUrl && (
                <div
                  className="mb-4 aspect-video w-full rounded-lg overflow-hidden"
                  style={{ backgroundImage: `url(${post.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                />
              )}
              <h2
                className="text-base font-semibold leading-snug group-hover:text-[var(--color-accent)] transition-colors"
                style={{ color: 'var(--color-primary)' }}
              >
                {post.title}
              </h2>
              {post.summary && (
                <p className="mt-2 text-sm leading-relaxed line-clamp-2" style={{ color: 'var(--color-muted-fg)' }}>
                  {post.summary}
                </p>
              )}
              {post.publishedAt && (
                <div className="mt-4 flex items-center gap-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {formatDate(post.publishedAt)}
                  </span>
                </div>
              )}
            </article>
          </Link>
        ))}
      </div>
    </div>
  )
}
