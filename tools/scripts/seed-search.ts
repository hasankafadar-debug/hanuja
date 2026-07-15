/**
 * Meilisearch Initial Seed Script
 *
 * Tüm yayındaki ürünleri Meilisearch'e yükler.
 * Çalıştırma: pnpm search:seed
 *
 * Ön koşul: Docker'da Meilisearch çalışıyor olmalı.
 * Güvenlik: Yalnızca status=published ürünler indexlenir.
 */

import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

const prisma = new PrismaClient()

const MEILI_URL = process.env.MEILISEARCH_URL ?? 'http://localhost:7700'
const MEILI_KEY = process.env.MEILISEARCH_ADMIN_KEY ?? ''

function meiliHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${MEILI_KEY}`,
  }
}

async function ensureIndex(indexName: string, primaryKey = 'id') {
  const res = await fetch(`${MEILI_URL}/indexes`, {
    method: 'POST',
    headers: meiliHeaders(),
    body: JSON.stringify({ uid: indexName, primaryKey }),
  })
  if (!res.ok && res.status !== 409) {
    throw new Error(`ensureIndex failed [${res.status}]: ${await res.text()}`)
  }
}

async function configureIndex(indexName: string, settings: Record<string, unknown>) {
  const res = await fetch(`${MEILI_URL}/indexes/${indexName}/settings`, {
    method: 'PATCH',
    headers: meiliHeaders(),
    body: JSON.stringify(settings),
  })
  if (!res.ok) {
    throw new Error(`configureIndex failed [${res.status}]: ${await res.text()}`)
  }
  const data = await res.json()
  console.log(`  ✓ Index ayarları güncellendi (taskUid: ${data.taskUid})`)
}

async function upsertDocuments(indexName: string, documents: object[]) {
  const res = await fetch(`${MEILI_URL}/indexes/${indexName}/documents`, {
    method: 'POST',
    headers: meiliHeaders(),
    body: JSON.stringify(documents),
  })
  if (!res.ok) {
    throw new Error(`upsertDocuments failed [${res.status}]: ${await res.text()}`)
  }
  const data = await res.json()
  console.log(`  ✓ ${documents.length} döküman gönderildi (taskUid: ${data.taskUid})`)
}

async function waitForTask(taskUid: number, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${MEILI_URL}/tasks/${taskUid}`, { headers: meiliHeaders() })
    const task = await res.json()
    if (task.status === 'succeeded') return
    if (task.status === 'failed') throw new Error(`Task ${taskUid} failed: ${JSON.stringify(task.error)}`)
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Task ${taskUid} timed out`)
}

async function clearDocuments(indexName: string) {
  const res = await fetch(`${MEILI_URL}/indexes/${indexName}/documents`, {
    method: 'DELETE',
    headers: meiliHeaders(),
  })
  if (!res.ok) {
    throw new Error(`clearDocuments failed [${res.status}]: ${await res.text()}`)
  }
  const task = await res.json()
  await waitForTask(task.taskUid)
  console.log(`  Cleared existing documents (taskUid: ${task.taskUid})`)
}

async function main() {
  console.log('🔍 Meilisearch seed başlıyor...')
  console.log(`   URL: ${MEILI_URL}`)

  // 1. Index var mı kontrol et / oluştur
  console.log('\n[1/3] products index hazırlanıyor...')
  await ensureIndex('products')

  // 2. Index ayarlarını yapılandır
  const settingsRes = await fetch(`${MEILI_URL}/indexes/products/settings`, {
    method: 'PATCH',
    headers: meiliHeaders(),
    body: JSON.stringify({
      searchableAttributes: ['name', 'description', 'categoryName', 'storeName'],
      filterableAttributes: ['categoryId', 'categorySlug', 'sellerId', 'storeSlug', 'stock'],
      sortableAttributes: ['price', 'name'],
      faceting: { maxValuesPerFacet: 100 },
    }),
  })
  if (!settingsRes.ok) {
    throw new Error(`configureIndex failed: ${await settingsRes.text()}`)
  }
  const settingsTask = await settingsRes.json()
  // Rebuild from the database so deleted or unpublished products cannot linger.
  await clearDocuments('products')
  console.log(`  ✓ Ayarlar gönderildi (taskUid: ${settingsTask.taskUid})`)

  // 3. Published ürünleri DB'den çek
  console.log('\n[2/3] Yayındaki ürünler veritabanından çekiliyor...')
  const products = await prisma.product.findMany({
    where: { status: 'published' },
    include: {
      images: { take: 1, orderBy: { sortOrder: 'asc' } },
      category: true,
      seller: { include: { profile: true } },
    },
  })

  console.log(`  ✓ ${products.length} yayında ürün bulundu`)

  if (products.length === 0) {
    console.log('\n⚠️  Yayında ürün yok. Önce pnpm db:seed çalıştırın.')
    return
  }

  // 4. Dökümanları hazırla
  const documents = products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description ?? '',
    price: p.price.toNumber(),
    categoryId: p.categoryId ?? '',
    categorySlug: p.category?.slug ?? '',
    categoryName: p.category?.name ?? '',
    sellerId: p.sellerId,
    storeSlug: p.seller?.slug ?? '',
    storeName: p.seller?.displayName ?? p.seller?.slug ?? '',
    imageUrl: p.images[0]?.url ?? null,
    stock: p.stockQuantity,
  }))

  // 5. Meilisearch'e gönder
  console.log('\n[3/3] Ürünler Meilisearch\'e yükleniyor...')
  const uploadRes = await fetch(`${MEILI_URL}/indexes/products/documents`, {
    method: 'POST',
    headers: meiliHeaders(),
    body: JSON.stringify(documents),
  })
  if (!uploadRes.ok) {
    throw new Error(`upsert failed: ${await uploadRes.text()}`)
  }
  const uploadTask = await uploadRes.json()
  console.log(`  ✓ ${documents.length} döküman gönderildi (taskUid: ${uploadTask.taskUid})`)

  // 6. Task tamamlanana kadar bekle
  console.log('  ⏳ Indexleme bekleniyor...')
  await waitForTask(uploadTask.taskUid)

  console.log('\n✅ Meilisearch seed tamamlandı!')
  console.log(`   ${documents.length} ürün indexlendi.`)
  console.log('\n   Test: http://localhost:3000/arama?q=masa')
}

main()
  .catch((err) => {
    console.error('\n❌ Seed hatası:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
