'use client';

import dynamic from 'next/dynamic';
import { FullScreenSpinner } from '@/components/ui';

// Every route shares one wallet boundary. The root route now resolves directly
// to Portfolio, so excluding `/` would briefly render a different wallet
// context and could lose a connect intent during the redirect.
const PrivyClientProvider = dynamic(
  () => import('@/components/PrivyClientProvider'),
  { loading: () => <FullScreenSpinner /> },
);

export default function WalletProviderBoundary({ children }: { children: React.ReactNode }) {
  // Telegram is an optional host capability, never an access gate. Direct
  // routes remain usable with Privy/browser wallets when the host bridge is
  // delayed or blocked; TelegramProvider binds the bridge progressively if
  // it becomes available later.
  return <PrivyClientProvider>{children}</PrivyClientProvider>;
}
