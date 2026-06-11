'use client';

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';

/**
 * Client-only, LAZY Privy wrapper (W-20).
 *
 * - SSG/pre-hydration: children render without Privy (Privy validates its app
 *   id at init and throws during static export otherwise).
 * - The Privy SDK is the heaviest dependency in the bundle; `lazy()` splits it
 *   into its own chunk so first paint / TTI doesn't wait for it. While the
 *   chunk loads, children render exactly as in the pre-mount state.
 */
const BasePrivyProvider = lazy(() =>
  import('@privy-io/react-auth').then((m) => ({ default: m.PrivyProvider }))
);

export function PrivyProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // During SSG prerendering (server) or before hydration, render children without Privy
  if (!mounted) {
    return <>{children}</>;
  }

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    console.warn('[PrivyProvider] NEXT_PUBLIC_PRIVY_APP_ID is not set');
    return <>{children}</>;
  }

  return (
    <Suspense fallback={<>{children}</>}>
      <BasePrivyProvider
        appId={appId}
        config={{
          appearance: {
            theme: 'light',
            accentColor: '#00d4aa',
            logo: 'https://fx.aladdin.club/favicon.ico',
          },
          embeddedWallets: {
            ethereum: {
              createOnLogin: 'users-without-wallets',
            },
          },
          loginMethods: ['email', 'wallet'],
        }}
      >
        {children}
      </BasePrivyProvider>
    </Suspense>
  );
}
