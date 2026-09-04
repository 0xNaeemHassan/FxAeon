import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Several legacy JSX-only leaf components are transformed for Next's browser
// bundle and expect a global React binding under this CJS smoke-test runner.
// Keep the compatibility shim isolated to this test process.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;

test('server-rendered shared position cards keep missing prices in a retrying state', async () => {
  try {
    const { ProtocolPositionCard } = await import('../src/components/ProtocolPositionCard');
    const html = renderToStaticMarkup(React.createElement(ProtocolPositionCard, {
      position: {
        market: 'ETH',
        side: 'long',
        info: {
          positionId: 42,
          rawColls: 10n ** 18n,
          rawDebts: 5n * 10n ** 17n,
          currentLeverage: 2,
          lsdLeverage: 2,
          rawCollsToken: 'wstETH',
          rawDebtsToken: 'fxUSD',
          rawCollsDecimals: 18,
          rawDebtsDecimals: 18,
        },
      },
    }));

    assert.match(html, /Est\. net equity/);
    assert.match(html, /Value loading/);
    assert.doesNotMatch(html, /USD unavailable/);
    assert.match(html, /Collateral value/);
    assert.match(html, /Debt value/);
  } finally {
    if (previousReact) globalReact.React = previousReact;
    else Reflect.deleteProperty(globalThis, 'React');
  }
});
