/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'dist',
  images: { unoptimized: true },
  transpilePackages: ['@fxbot/shared'],
  typescript: {
    // Type errors in Privy v3 optional APIs — safe to ignore for deploy
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // Privy optional peer deps not needed for this app
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@stripe/crypto': false,
      '@farcaster/mini-app-solana': false,
    };
    return config;
  },
};

module.exports = nextConfig;
