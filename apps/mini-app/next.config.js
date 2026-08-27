/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // `pnpm lint` is an explicit release gate. Skipping Next's duplicate build
  // lint keeps static export output deterministic and avoids the framework's
  // legacy Pages-router plugin discovery warning with flat ESLint config.
  eslint: { ignoreDuringBuilds: true },
  // Keep hot-reload artifacts separate from the static export. A production
  // build replaces `dist`; sharing it with `next dev` can delete the running
  // server's routes-manifest mid-request (especially during parallel CI/QA).
  distDir: process.env.NODE_ENV === 'development' ? '.next' : 'dist',
  images: { unoptimized: true },
  webpack: (config, { webpack }) => {
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
