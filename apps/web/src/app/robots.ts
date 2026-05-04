import type { MetadataRoute } from 'next'
import { buildRobotsConfig } from '@hanuja/seo'
import { DEFAULT_WEB_URL } from '@hanuja/api/lib/platform-info'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_WEB_URL
  return buildRobotsConfig(`${baseUrl}/sitemap.xml`)
}
