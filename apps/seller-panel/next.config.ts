import type { NextConfig } from 'next'

const remoteImageHostnames = Array.from(
  new Set(
    [
      'cdn.hanuja.com.tr',
      'media.hanuja.tr',
      // Legacy compatibility for media URLs already stored in the database.
      'media.hanuja.com.tr',
      'cdn.hanuja.com',
      process.env.R2_PUBLIC_HOSTNAME,
    ].filter((hostname): hostname is string => Boolean(hostname)),
  ),
)

const standaloneOutput = process.platform === 'win32' ? {} : { output: 'standalone' as const }

const config: NextConfig = {
  ...standaloneOutput,
  serverExternalPackages: ['iyzipay', '@prisma/client', 'prisma', 'better-auth'],
  experimental: {
    // Next clones every non-GET body matched by the middleware and hands the route
    // only the first `middlewareClientMaxBodySize` bytes (default 10 MiB). Seller
    // document, contract and invoice uploads go through this middleware, so the
    // limit must sit above the largest route envelope (contracts: 100 MiB +
    // 5 MiB multipart overhead) for the route's own bounded reader to decide —
    // and answer 413 — instead of a truncated multipart body. Renamed to
    // `proxyClientMaxBodySize` in Next 16. Guarded by
    // tests/unit/seller-panel-middleware-body-limit.test.ts.
    middlewareClientMaxBodySize: 106 * 1024 * 1024,
  },
  transpilePackages: ['@hanuja/ui', '@hanuja/security', '@hanuja/types', '@hanuja/api'],
  images: {
    localPatterns: [
      {
        pathname: '/api/media/fetch',
      },
      {
        pathname: '/api/media/private/**',
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
