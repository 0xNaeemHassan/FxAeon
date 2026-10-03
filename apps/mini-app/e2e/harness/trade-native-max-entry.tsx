import React from 'react';
import { createRoot } from 'react-dom/client';
import TradePage from '@/app/trade/page';

type Deferred = { resolve: (value: bigint) => void; reject: (error: Error) => void };
type HarnessState = {
  balance: string;
  chainId: number;
  address: string;
  requests: Array<{ balanceWei: bigint; deferred: Deferred }>;
  rerender?: () => void;
};

declare global { var __tradeMaxHarness: HarnessState; }

globalThis.__tradeMaxHarness = {
  balance: '1', chainId: 1, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', requests: [],
};
function Harness() {
  const [, update] = React.useState(0);
  React.useEffect(() => { globalThis.__tradeMaxHarness.rerender = () => update((value) => value + 1); }, []);
  return <React.StrictMode><TradePage /></React.StrictMode>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Harness />);
document.documentElement.dataset.harnessReady = 'true';

export {};
