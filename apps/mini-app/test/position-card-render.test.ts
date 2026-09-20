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

test('server-rendered shared position cards use accessible placeholders and preserve raw units', async () => {
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

    assert.match(html, /Position value/);
    assert.match(html, /aria-label="Loading value"/);
    assert.doesNotMatch(html, /title="—"|Value loading|Price delayed|USD unavailable/);
    assert.match(html, /1 wstETH/);
    assert.match(html, /0\.5 fxUSD/);
    assert.match(html, /Collateral/);
    assert.match(html, /Debt/);
    assert.match(html, /Market price/);
    assert.match(html, /Debt \/ collateral/);


    const zeroHtml = renderToStaticMarkup(React.createElement(ProtocolPositionCard, {
      position: {
        market: 'ETH',
        side: 'long',
        info: {
          positionId: 43,
          rawColls: 0n,
          rawDebts: 0n,
          currentLeverage: 2,
          lsdLeverage: 2,
          rawCollsToken: 'wstETH',
          rawDebtsToken: 'fxUSD',
          rawCollsDecimals: 18,
          rawDebtsDecimals: 18,
        },
      },
    }));
    assert.ok((zeroHtml.match(/\$0\.00/g) ?? []).length >= 3, 'known zero balances stay visible as $0.00');
  } finally {
    if (previousReact) globalReact.React = previousReact;
    else Reflect.deleteProperty(globalThis, 'React');
  }
});
