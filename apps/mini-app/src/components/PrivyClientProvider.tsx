'use client';

/**
 * Privy provider — the foundation of user-owned wallets.
 *
 * Users CREATE or IMPORT their embedded wallet client-side via the Privy SDK
 * (keys in Privy's TEE, exportable by the user, never visible to the FxAeon
 * backend). Telegram seamless login means no email/password: the Mini App's
 * signed init data authenticates the user with Privy directly.
 *
 * Login methods are intentionally NOT pinned here: `loginMethods` in this
 * config OVERRIDES the Privy dashboard, which is exactly how Google login
 * silently disappeared once (the dashboard had it on, the hardcoded
 * `['telegram']` here suppressed it). Leave it unset so the dashboard is the
 * single source of truth — Telegram stays primary in our own flow
 * (login/PrivyFlow.tsx), and the Privy modal offers whatever else the
 * dashboard enables (Google, external wallets, …).
 *
 * PERF (W-20): this provider is intentionally NOT in the root layout. The
 * Privy SDK is heavy; only the surfaces that actually need it (/login flow,
 * Settings → Wallet) mount it — via next/dynamic so the SDK chunk never
 * blocks first paint anywhere.
 *
 * Graceful degradation: when NEXT_PUBLIC_PRIVY_APP_ID isn't baked into the
 * build, children render without the provider and pages show honest
 * "wallet service not configured" copy instead of crashing.
 */
import { PrivyProvider } from '@privy-io/react-auth';
import { PRIVY_APP_ID } from '@/lib/privyConfig';

export default function PrivyClientProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#2ee6a8',
          // Ethereum-only app; hide Solana-flavored wallet options.
          walletChainType: 'ethereum-only',
        },
        embeddedWallets: {
          // Wallet creation is an EXPLICIT user choice (create vs import) on
          // the login screen — never automatic.
          ethereum: { createOnLogin: 'off' },
          showWalletUIs: true,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
