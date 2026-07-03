import type { NextConfig } from 'next'

const remoteImageHostnames = Array.from(
  new Set(
    ['cdn.hanuja.com.tr', 'media.hanuja.com.tr', 'cdn.hanuja.com', process.env.R2_PUBLIC_HOSTNAME].filter(
      (hostname): hostname is string => Boolean(hostname),
    ),
  ),
)

const standaloneOutput = process.platform === 'win32' ? {} : { output: 'standalone' as const }

const config: NextConfig = {
  ...standaloneOutput,
  serverExternalPackages: ['iyzipay', '@prisma/client', 'prisma', 'better-auth'],
  transpilePackages: ['@hanuja/ui', '@hanuja/security', '@hanuja/types', '@hanuja/api'],
  images: {
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
  // typedRoutes: true, — disabled: dynamic router.push strings not compatible
}

export default config
