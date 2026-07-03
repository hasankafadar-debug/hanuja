import type { NextConfig } from 'next'

const remoteImageHostnames = Array.from(
  new Set(
    [
      'cdn.hanuja.com.tr',
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
  allowedDevOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
  serverExternalPackages: ['iyzipay', '@prisma/client', 'prisma', 'better-auth'],
  transpilePackages: ['@hanuja/ui', '@hanuja/seo', '@hanuja/security', '@hanuja/types', '@hanuja/api'],
  images: {
    formats: ['image/avif', 'image/webp'],
    localPatterns: [
      {
        pathname: '/api/media/fetch',
      },
    ],
    remotePatterns: remoteImageHostnames.map((hostname) => ({
      protocol: 'https',
      hostname,
    })),
  },
  // typedRoutes: true, — disabled: dynamic auth callbackUrl not compatible
}

export default config
