'use client';

/**
 * App-wide Privy provider — the foundation of user-owned wallets.
 *
 * Users CREATE or IMPORT their embedded wallet here, client-side, via the
 * Privy SDK (keys in Privy's TEE, exportable by the user, never visible to
 * the FxAeon backend). Telegram seamless login means no email/password: the
 * Mini App's signed init data authenticates the user with Privy directly.
 *
 * Graceful degradation: when NEXT_PUBLIC_PRIVY_APP_ID isn't baked into the
 * build, children render without the provider and pages show honest
 * "wallet service not configured" copy instead of crashing.
 */
import { PrivyProvider } from '@privy-io/react-auth';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

/** True when this build can talk to Privy. */
export function privyConfigured(): boolean {
  return Boolean(APP_ID);
}

/**
 * The Privy dashboard key-quorum id used for session-signer grants ("bot
 * trading"). Without it, wallets still work — only chat-based execution
 * stays off until the user grants access.
 */
export const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID || '';

export default function PrivyClientProvider({ children }: { children: React.ReactNode }) {
  if (!APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        // Telegram seamless login only — inside a TMA the signed init data
        // logs the user in without any extra prompt.
        loginMethods: ['telegram'],
        appearance: {
          theme: 'dark',
          accentColor: '#2ee6a8',
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
