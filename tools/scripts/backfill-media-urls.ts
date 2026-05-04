#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client'
import 'dotenv/config'
import { normalizeManagedMediaUrl } from '../../api/lib/media-url'

const prisma = new PrismaClient()

function normalizeVariants(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeVariants(entry))
  }

  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? normalizeManagedMediaUrl(value) : value
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
    key,
    normalizeVariants(entryValue),
  ])

  return Object.fromEntries(entries)
}

function hasChanged(left: unknown, right: unknown) {
  return JSON.stringify(left) !== JSON.stringify(right)
}

async function main() {
  const publicBaseUrl = process.env.R2_PUBLIC_URL?.trim()
  if (!publicBaseUrl) {
    throw new Error('R2_PUBLIC_URL tanımlı değil. Önce hedef medya domainini .env içine yazın.')
  }

  console.log(`Medya URL backfill başlıyor -> ${publicBaseUrl}`)

  const [productImages, mediaAssets] = await Promise.all([
    prisma.productImage.findMany({
      select: { id: true, url: true },
    }),
    prisma.mediaAsset.findMany({
      select: { id: true, url: true, variants: true },
    }),
  ])

  let updatedProductImages = 0
  for (const image of productImages) {
    const nextUrl = normalizeManagedMediaUrl(image.url, publicBaseUrl)
    if (nextUrl === image.url) continue

    await prisma.productImage.update({
      where: { id: image.id },
      data: { url: nextUrl },
    })
    updatedProductImages += 1
  }

  let updatedMediaAssets = 0
  for (const asset of mediaAssets) {
    const nextUrl = normalizeManagedMediaUrl(asset.url, publicBaseUrl)
    const nextVariants = normalizeVariants(asset.variants)
    if (nextUrl === asset.url && !hasChanged(asset.variants, nextVariants)) continue

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        url: nextUrl,
        variants: nextVariants as object | null,
      },
    })
    updatedMediaAssets += 1
  }

  console.log(`ProductImage güncellendi: ${updatedProductImages}`)
  console.log(`MediaAsset güncellendi: ${updatedMediaAssets}`)
}

main()
  .catch((error) => {
    console.error('Medya URL backfill hatası:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
