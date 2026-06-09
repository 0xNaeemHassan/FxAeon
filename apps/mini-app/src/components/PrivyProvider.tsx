'use client';

import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth';

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  return (
    <BasePrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''}
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
