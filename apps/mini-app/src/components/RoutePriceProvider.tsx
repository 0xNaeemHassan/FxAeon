'use client';

import dynamic from 'next/dynamic';

// Keep one stable context around the app, while PriceProvider itself only
// starts HTTP/WebSocket work after a product route or the wallet profile
// acquires price demand through WalletDataProvider.
const PriceProvider = dynamic(() => import('@/components/PriceProvider'));

export default function RoutePriceProvider({ children }: { children: React.ReactNode }) {
  return <PriceProvider>{children}</PriceProvider>;
}
