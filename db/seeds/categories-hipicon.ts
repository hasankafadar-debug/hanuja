// =============================================================================
// UYARI — BU LANSMAN TAKSONOMİSİ DEĞİLDİR.
// =============================================================================
// Bu seed, Hipicon kaynaklı geniş bir kategori ağacı üretir. Storefront navigasyonu
// (`apps/web/src/config/storefront-nav.ts`) ise EV + OFİS slug'larına HARD-CODED'dur.
// Bu script'i üretimde çalıştırmak, storefront'un asla göstermediği ORPHAN bir
// taksonomi (bağlı olmayan kategoriler) oluşturur ve SEO/navigasyon tutarsızlığı
// yaratır. Lansman kategorileri seed.ts + storefront-nav.ts üzerinden yönetilir.
// Buradaki hiçbir mantığı değiştirmeyin; yalnızca bilinçli dev senaryolarında kullanın.
// =============================================================================

import { PrismaClient } from '@prisma/client'
import { normalizeSlug } from '../../api/domain/slug'

interface CategoryNode {
  name: string
  slug?: string
  children?: CategoryNode[]
}

const prisma = new PrismaClient()

const ROOT_SLUG_MAP: Record<string, string> = {
  Mobilya: 'mobilya',
  Dekorasyon: 'dekor',
  'Ev Tekstili': 'ev-tekstili',
  Aydınlatma: 'aydinlatma',
  'Mutfak & Sofra': 'mutfak',
  'Bahçe & Balkon': 'bahce-balkon',
  Ofis: 'ofis',
}

export const CATEGORY_TREE: CategoryNode[] = [
  {
    name: 'Mobilya',
    children: [
      { name: 'Koltuk & Berjer', slug: 'koltuk-berjer' },
      { name: 'Orta & Yan Sehpa', slug: 'sehpa-modelleri' },
      { name: 'Masa', slug: 'masa' },
      { name: 'Sandalye & Tabure', slug: 'sandalye-tabure' },
      { name: 'Yatak & Komodin', slug: 'yatak-komodin' },
      { name: 'Raf & Kitaplık', slug: 'raf-kitaplik' },
    ],
  },
  {
    name: 'Dekorasyon',
    children: [
      { name: 'Vazo & Saksı', slug: 'vazo-saksi' },
      { name: 'Mumluk & Mum', slug: 'mumluk-mum' },
      { name: 'Ayna', slug: 'ayna' },
      { name: 'Tablo & Poster', slug: 'tablo-poster' },
      { name: 'Duvar Dekoru', slug: 'duvar-dekoru' },
    ],
  },
  {
    name: 'Ev Tekstili',
    children: [
      {
        name: 'Havlu & Peştemal',
        slug: 'havlu-pestemal',
        children: [{ name: 'Vücut Havlusu', slug: 'vucut-havlusu' }],
      },
      { name: 'Yatak & Koltuk Örtüleri', slug: 'nevresim-ortu' },
      { name: 'Kırlent', slug: 'kirlent' },
      { name: 'Halı', slug: 'hali' },
      { name: 'Nevresim', slug: 'nevresim' },
    ],
  },
  {
    name: 'Aydınlatma',
    children: [
      { name: 'Dekoratif Aydınlatma', slug: 'dekoratif-aydinlatma' },
      { name: 'Yer Aydınlatmaları', slug: 'yer-aydinlatmalari' },
      { name: 'Sarkıt Aydınlatma', slug: 'sarkit-aydinlatma' },
      { name: 'Masa Lambası', slug: 'masa-lambasi' },
    ],
  },
  {
    name: 'Mutfak & Sofra',
    children: [
      { name: 'Bardak & Fincan & Kupa', slug: 'bardak-fincan-kupa' },
      { name: 'Tabak & Kase', slug: 'tabak-kase' },
      { name: 'Servis & Sunum', slug: 'servis-sunum' },
      { name: 'Çatal Bıçak & Kaşık', slug: 'catal-bicak-kasik' },
      { name: 'Mutfak Gereçleri', slug: 'mutfak-gerecleri' },
    ],
  },
  {
    name: 'Bahçe & Balkon',
    children: [
      { name: 'Dış Mekan Mobilya', slug: 'dis-mekan-mobilya' },
      { name: 'Saksı & Bitki', slug: 'saksi-bitki' },
      { name: 'Bahçe Aydınlatması', slug: 'bahce-aydinlatmasi' },
    ],
  },
  {
    name: 'Ofis',
    children: [
      { name: 'Çalışma Masası', slug: 'calisma-masasi' },
      { name: 'Ofis Aydınlatma', slug: 'ofis-aydinlatma' },
      { name: 'Depolama & Düzen', slug: 'depolama-duzen' },
    ],
  },
  {
    name: 'Banyo',
    children: [
      { name: 'Banyo Aksesuarları', slug: 'banyo-aksesuarlari' },
      { name: 'Banyo Tekstili', slug: 'banyo-tekstili' },
      { name: 'Banyo Setleri', slug: 'banyo-setleri' },
    ],
  },
  {
    name: 'Çocuk Odası',
    children: [
      { name: 'Çocuk Odası Mobilya', slug: 'cocuk-odasi-mobilya' },
      { name: 'Çocuk Odası Aydınlatma', slug: 'cocuk-odasi-aydinlatma' },
      { name: 'Çocuk Odası Duvar Dekoru', slug: 'cocuk-odasi-duvar-dekoru' },
    ],
  },
]

function resolveNodeSlug(node: CategoryNode, depth: number) {
  if (depth === 0 && ROOT_SLUG_MAP[node.name]) {
    return ROOT_SLUG_MAP[node.name]
  }

  return node.slug ?? normalizeSlug(node.name)
}

async function upsertNode(
  node: CategoryNode,
  depth: number,
  sortOrder: number,
  parentId: string | null,
) {
  const slug = resolveNodeSlug(node, depth)

  const category = await prisma.category.upsert({
    where: { slug },
    update: {
      name: node.name,
      parentId,
      sortOrder,
      isActive: true,
    },
    create: {
      slug,
      name: node.name,
      parentId,
      sortOrder,
      isActive: true,
    },
  })

  for (const [childIndex, child] of (node.children ?? []).entries()) {
    await upsertNode(child, depth + 1, childIndex + 1, category.id)
  }
}

export async function seedCategoryTree() {
  for (const [index, node] of CATEGORY_TREE.entries()) {
    await upsertNode(node, 0, index + 1, null)
  }
}

async function main() {
  await seedCategoryTree()
  console.log(`Seeded ${CATEGORY_TREE.length} Hipicon root categories.`)
}

main()
  .catch((error) => {
    console.error('Hipicon category seed failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
