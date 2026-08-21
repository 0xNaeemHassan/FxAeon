/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // Keep hot-reload artifacts separate from the static export. A production
  // build replaces `dist`; sharing it with `next dev` can delete the running
  // server's routes-manifest mid-request (especially during parallel CI/QA).
  distDir: process.env.NODE_ENV === 'development' ? '.next' : 'dist',
  images: { unoptimized: true },
  transpilePackages: ['@fxaeon/shared'],
  webpack: (config, { webpack }) => {
    // Let webpack resolve .js imports to .ts/.tsx source files
    // (needed because shared package uses ESM .js extensions)
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    // Privy publishes optional integrations as dynamic imports in its main
    // entrypoint. FxAeon does not enable Stripe onramping or Farcaster/Solana;
    // explicitly ignore those optional peers instead of shipping dead code or
    // producing a misleading module-not-found warning on every release build.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^(@stripe\/crypto|@farcaster\/mini-app-solana)$/,
      })
    );
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      // ox/viem's Tempo worker loader intentionally selects a module at
      // runtime. Webpack cannot statically enumerate it, but it is not used by
      // FxAeon's Ethereum-only routes.
      { module: /ox[\\/]_esm[\\/]tempo[\\/]internal[\\/]virtualMasterPool/, message: /Critical dependency/ },
    ];
    return config;
  },
};

module.exports = nextConfig;
