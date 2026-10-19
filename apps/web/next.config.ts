import type { NextConfig } from 'next'

const remoteImageHostnames = Array.from(
  new Set(
    [
      'cdn.hanuja.com.tr',
      'media.hanuja.tr',
      // Legacy compatibility for media URLs already stored in the database.
      'media.hanuja.com.tr',
      'cdn.hanuja.com',
      'images.unsplash.com',
      process.env.R2_PUBLIC_HOSTNAME,
    ].filter((hostname): hostname is string => Boolean(hostname)),
  ),
)

const standaloneOutput = process.platform === 'win32' ? {} : { output: 'standalone' as const }

const config: NextConfig = {
  ...standaloneOutput,
  compress: true,
  async headers() {
    // The invitation and its media are unlisted. Public store/catalog SEO is unchanged.
    return ['/tasarimci-daveti', '/designer-invitation/:path*'].map((source) => ({
      source,
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    }))
  },
  allowedDevOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
  serverExternalPackages: ['iyzipay', '@prisma/client', 'prisma', 'better-auth'],
  transpilePackages: [
    '@hanuja/ui',
    '@hanuja/seo',
    '@hanuja/security',
    '@hanuja/types',
    '@hanuja/api',
  ],
  images: {
    unoptimized: process.env.NODE_ENV === 'development' && Boolean(process.env.R2_LOCAL_ENDPOINT),
    formats: ['image/avif', 'image/webp'],
    localPatterns: [
      {
        pathname: '/api/media/fetch',
      },
      {
        pathname: '/api/media/private/**',
      },
    ],
    remotePatterns: [
      ...(process.env.NODE_ENV === 'development' && process.env.R2_LOCAL_ENDPOINT
        ? [{ protocol: 'http' as const, hostname: '127.0.0.1', port: '9000' }]
        : []),
      ...remoteImageHostnames.map(
        (hostname) =>
          ({
            protocol: 'https',
            hostname,
          }) as const,
      ),
    ],
  },
  // typedRoutes: true, — disabled: dynamic auth callbackUrl not compatible
}

export default config
