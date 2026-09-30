import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MovePage from '@/app/move/page';

type HarnessState = {
  wallet: { ready: boolean; authenticated: boolean; address?: string; chainId: number; connectionVersion: number };
  rerender?: () => void;
};

declare global {
  var __moveSessionHarness: HarnessState;
}

function Harness() {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => { globalThis.__moveSessionHarness.rerender = () => setVersion((value) => value + 1); }, []);
  return <MovePage />;
}

const root: Root = createRoot(document.getElementById('root')!);
globalThis.__moveSessionHarness = {
  wallet: { ready: true, authenticated: true, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', chainId: 1, connectionVersion: 1 },
};
root.render(<Harness />);
document.documentElement.dataset.harnessReady = 'true';

export {};
