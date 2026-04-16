import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@hanuja/ui', '@hanuja/seo', '@hanuja/security', '@hanuja/types', '@hanuja/api'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: process.env.R2_PUBLIC_HOSTNAME ?? 'placeholder.hanuja.com',
      },
    ],
  },
  // typedRoutes: true, — disabled: dynamic auth callbackUrl not compatible
}

export default config
