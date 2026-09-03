'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { FullScreenSpinner } from '@/components/ui';

// Keep Privy and its wallet-connector graph out of the public browser landing
// chunk. Every wallet-capable route still shares exactly one provider mounted
// above its page tree.
const PrivyClientProvider = dynamic(
  () => import('@/components/PrivyClientProvider'),
  { loading: () => <FullScreenSpinner /> },
);

export default function WalletProviderBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Telegram is an optional host capability, never an access gate. Direct
  // routes remain usable with Privy/browser wallets when the host bridge is
  // delayed or blocked; TelegramProvider binds the bridge progressively if
  // it becomes available later.
  if (pathname === '/') return <>{children}</>;
  return <PrivyClientProvider>{children}</PrivyClientProvider>;
}
