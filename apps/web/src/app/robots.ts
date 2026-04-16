import type { MetadataRoute } from 'next'
import { buildRobotsConfig } from '@hanuja/seo'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hanuja.com'
  return buildRobotsConfig(`${baseUrl}/sitemap.xml`)
}
