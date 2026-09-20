'use client';

import dynamic from 'next/dynamic';
import { PRIVY_APP_ID } from '@/lib/privyConfig';

function ProviderLoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading FxAeon"
      className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <span aria-hidden="true" className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--mint)] border-t-transparent" />
      <span className="text-sm text-mut">Loading FxAeon…</span>
    </div>
  );
}

// The configured-provider browser check found different server/client useId
// paths under this boundary. Keep that branch client-only so descendants mount
// once; the no-Privy public/static build remains SSR-rendered.
const PrivyClientProvider = dynamic(
  () => import('@/components/PrivyClientProvider'),
  { loading: () => <ProviderLoadingState />, ssr: !PRIVY_APP_ID },
);

export default function WalletProviderBoundary({ children }: { children: React.ReactNode }) {
  // Telegram is an optional host capability, never an access gate. Direct
  // routes remain usable with Privy/browser wallets when the host bridge is
  // delayed or blocked; TelegramProvider binds the bridge progressively if
  // it becomes available later.
  return <PrivyClientProvider>{children}</PrivyClientProvider>;
}
