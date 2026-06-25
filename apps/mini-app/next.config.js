/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'dist',
  images: { unoptimized: true },
  transpilePackages: ['@fxaeon/shared'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // Let webpack resolve .js imports to .ts/.tsx source files
    // (needed because shared package uses ESM .js extensions)
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

module.exports = nextConfig;
