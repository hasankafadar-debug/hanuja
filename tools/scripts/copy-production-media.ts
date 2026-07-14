#!/usr/bin/env tsx
import { CopyObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { config } from 'dotenv'

config()
const required = (key: string) => {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} zorunlu.`)
  return value
}
const sourceBucket = required('R2_SOURCE_BUCKET_NAME')
const targetBucket = required('R2_BUCKET_NAME')
const publicUrl = required('R2_PUBLIC_URL').replace(/\/$/, '')
if (sourceBucket === targetBucket) throw new Error('Dev ve production R2 bucket aynı olamaz.')

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: required('R2_ACCESS_KEY_ID'), secretAccessKey: required('R2_SECRET_ACCESS_KEY') },
})
const prisma = new PrismaClient()

async function main() {
  const [slides, promos, media, blogs] = await Promise.all([
    prisma.homeSlide.findMany({ select: { mediaAssetId: true, posterAssetId: true } }),
    prisma.homePromo.findMany({ select: { mediaAssetId: true } }),
    prisma.mediaAsset.findMany(),
    prisma.blogPost.findMany({ where: { slug: { in: ['kucuk-salon-dekorasyon-fikirleri-2025', 'ev-ofis-duzeni-nasil-kurulur-verimli-calisma-alani'] } }, select: { id: true, slug: true, coverUrl: true } }),
  ])
  const allowedIds = new Set([...slides.flatMap((x) => [x.mediaAssetId, ...(x.posterAssetId ? [x.posterAssetId] : [])]), ...promos.map((x) => x.mediaAssetId)])
  const unexpected = media.filter((asset) => !allowedIds.has(asset.id))
  if (unexpected.length) throw new Error(`CMS dışı media asset bulundu; kopyalama reddedildi: ${unexpected.map((x) => x.id).join(', ')}`)

  for (const asset of media) {
    if (!asset.key) throw new Error(`Media key eksik: ${asset.id}`)
    const encodedKey = asset.key.split('/').map(encodeURIComponent).join('/')
    await client.send(new CopyObjectCommand({ Bucket: targetBucket, Key: asset.key, CopySource: `${sourceBucket}/${encodedKey}` }))
    await client.send(new HeadObjectCommand({ Bucket: targetBucket, Key: asset.key }))
  }

  const blogUpdates: Array<{ id: string; coverUrl: string }> = []
  for (const blog of blogs) {
    if (!blog.coverUrl) throw new Error(`Blog kapak görseli eksik: ${blog.slug}`)
    const response = await fetch(blog.coverUrl)
    if (!response.ok) throw new Error(`Blog görseli indirilemedi (${response.status}): ${blog.slug}`)
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error(`Blog MIME reddedildi: ${contentType}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) throw new Error(`Blog görsel boyutu reddedildi: ${blog.slug}`)
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
    const key = `blog/${blog.slug}/${createHash('sha256').update(bytes).digest('hex')}.${extension}`
    await client.send(new PutObjectCommand({ Bucket: targetBucket, Key: key, Body: bytes, ContentType: contentType, CacheControl: 'public,max-age=31536000,immutable' }))
    await client.send(new HeadObjectCommand({ Bucket: targetBucket, Key: key }))
    blogUpdates.push({ id: blog.id, coverUrl: `${publicUrl}/${key}` })
  }

  await prisma.$transaction([
    ...media.map((asset) => prisma.mediaAsset.update({ where: { id: asset.id }, data: { url: `${publicUrl}/${asset.key}` } })),
    ...blogUpdates.map((blog) => prisma.blogPost.update({ where: { id: blog.id }, data: { coverUrl: blog.coverUrl } })),
  ])
  console.log(`OK: ${media.length} CMS medyası ve ${blogUpdates.length} blog görseli production R2'ye kopyalandı.`)
}

main().finally(() => prisma.$disconnect())
