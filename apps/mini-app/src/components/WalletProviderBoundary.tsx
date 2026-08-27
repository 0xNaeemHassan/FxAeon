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
  if (pathname === '/') return <>{children}</>;
  return <PrivyClientProvider>{children}</PrivyClientProvider>;
}
