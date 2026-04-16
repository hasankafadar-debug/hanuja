import type { Metadata } from 'next'
import Link from 'next/link'
import { ProductCard } from '@hanuja/ui'
import { ArrowRight, Sofa, Lamp, Flower2, BriefcaseBusiness, Bath } from 'lucide-react'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Hanuja — Ev, Ofis & Yaşam Ürünleri',
  description:
    "Yaşam alanlarınız için seçkin mobilya, dekor, aydınlatma ve ofis ürünleri. Türkiye'nin en iyi tasarım mağazaları tek platformda.",
}

const FEATURED_CATEGORIES = [
  { label: 'Mobilya', description: 'Masif ahşaptan modern tasarımlara', href: '/kategori/mobilya', Icon: Sofa },
  { label: 'Dekor', description: 'Mekanınıza ruh katan objeler', href: '/kategori/dekor', Icon: Flower2 },
  { label: 'Aydınlatma', description: 'Doğru ışık, doğru atmosfer', href: '/kategori/aydinlatma', Icon: Lamp },
  { label: 'Ofis', description: 'Üretken çalışma alanları için', href: '/kategori/ofis', Icon: BriefcaseBusiness },
  { label: 'Banyo', description: "Banyonuzu bir spa'ya dönüştürün", href: '/kategori/banyo', Icon: Bath },
]

async function getFeaturedProducts() {
  try {
    const svc = createCatalogService({ prisma: createPrismaForRoute() })
    return await svc.listPublished({ skip: 0, take: 8 })
  } catch {
    return []
  }
}

export default async function HomePage() {
  const featuredProducts = await getFeaturedProducts()

  type ProductRow = {
    id: string
    name: string
    slug: string
    price: { toNumber(): number } | number
    images: Array<{ url: string }>
    seller: { displayName: string; slug: string } | null
  }

  return (
    <div style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Hero */}
      <section className="relative overflow-hidden" style={{ backgroundColor: 'var(--color-primary)' }}>
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-widest" style={{ color: 'var(--color-accent)' }}>
              Yeni Koleksiyon 2025
            </p>
            <h1
              className="mt-4 text-5xl font-bold leading-tight sm:text-6xl"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary-fg)' }}
            >
              Yaşam Alanınızı <br />
              Yeniden Keşfedin
            </h1>
            <p className="mt-6 text-lg leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Seçkin tasarımcılar ve zanaatkâr mağazalarından mobilya, dekor ve yaşam ürünleri. Evinize değer
              katacak her şey tek platformda.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href="/kategori/mobilya"
                className="inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
              >
                Koleksiyonu Keşfet
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/blog"
                className="inline-flex items-center gap-2 rounded-full border px-8 py-3 text-sm font-semibold transition-colors"
                style={{ borderColor: 'rgba(255,255,255,0.3)', color: 'var(--color-primary-fg)' }}
              >
                İlham Al
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Categories */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h2 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}>
              Kategoriler
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              İhtiyacınıza göre keşfetmeye başlayın
            </p>
          </div>
          <Link
            href="/kategori"
            className="hidden text-sm font-medium sm:inline-flex items-center gap-1 transition-colors hover:opacity-80"
            style={{ color: 'var(--color-accent)' }}
          >
            Tüm kategoriler
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {FEATURED_CATEGORIES.map((cat) => (
            <Link
              key={cat.href}
              href={cat.href}
              className="group flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-shadow hover:shadow-md"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full transition-colors group-hover:bg-[var(--color-accent)]"
                style={{ backgroundColor: 'var(--color-muted)' }}
              >
                <cat.Icon
                  className="h-6 w-6 transition-colors group-hover:text-white"
                  style={{ color: 'var(--color-primary)' }}
                />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>{cat.label}</p>
                <p className="mt-0.5 text-xs leading-snug" style={{ color: 'var(--color-muted-fg)' }}>{cat.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-16" style={{ backgroundColor: 'var(--color-muted)' }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex items-end justify-between">
            <div>
              <h2
                className="text-3xl font-bold"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
              >
                Öne Çıkan Ürünler
              </h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Editörlerimizin seçtikleri
              </p>
            </div>
            <Link
              href="/kategori/mobilya"
              className="hidden text-sm font-medium sm:inline-flex items-center gap-1 transition-colors hover:opacity-80"
              style={{ color: 'var(--color-accent)' }}
            >
              Tümünü gör
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {featuredProducts.length === 0 ? (
            <p className="text-center text-sm py-10" style={{ color: 'var(--color-muted-fg)' }}>
              Henüz ürün eklenmemiş.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {(featuredProducts as unknown as ProductRow[]).map((product) => {
                const price = typeof product.price === 'object' ? product.price.toNumber() : Number(product.price)
                const imageUrl = product.images?.[0]?.url
                return (
                  <ProductCard
                    key={product.id}
                    id={product.id}
                    title={product.name}
                    slug={product.slug}
                    price={price}
                    {...(imageUrl ? { imageUrl } : {})}
                    {...(product.seller ? { sellerName: product.seller.displayName, sellerSlug: product.seller.slug } : {})}
                  />
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Editorial CTA */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div
          className="rounded-2xl px-8 py-14 text-center sm:px-16"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <h2
            className="text-3xl font-bold sm:text-4xl"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary-fg)' }}
          >
            Evi Sıfırdan mı Döşüyorsunuz?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Uzman içeriklerimiz ve ilham veren rehberlerimizle doğru ürünleri daha kolay bulun. Mobilyadan
            aydınlatmaya her şey için fikirler blog&apos;da sizi bekliyor.
          </p>
          <Link
            href="/blog"
            className="mt-8 inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
          >
            Blog&apos;u Keşfet
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
