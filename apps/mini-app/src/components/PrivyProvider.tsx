'use client';

import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Client-only Privy wrapper.
 * During Next.js static export (SSG), pages are prerendered on the server.
 * Privy validates its app ID at init and throws if it's missing/invalid.
 * We skip rendering the provider on the server and only mount it client-side.
 */
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
    <BasePrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: 'light',
          accentColor: '#00d4aa',
          logo: 'https://fx.aladdin.club/favicon.ico',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        loginMethods: ['telegram', 'email'],
      }}
    >
      {children}
    </BasePrivyProvider>
  );
}
