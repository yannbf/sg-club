import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'shared.akamai.steamstatic.com',
        pathname: '/store_item_assets/steam/**',
      },
      {
        protocol: 'https',
        hostname: 'steamplayercount.com',
        pathname: '/theme/img/**',
      },
    ],
  },
  // Disable server-side features for static export
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
}

export default nextConfig
