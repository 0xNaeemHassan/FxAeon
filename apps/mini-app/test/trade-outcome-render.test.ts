import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { positionCollateralTokenAddress, positionDebtTokenAddress, positionPoolAddress } from '../src/lib/fx/policy';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import type { PlannedRoute } from '../src/lib/fx/types';

// Match the isolated JSX/CSS loader used by the other component render tests.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions['.css'];
const stylesPath = fileURLToPath(new URL('../src/components/TradeOutcomePreview.module.css', import.meta.url)).toLowerCase();
testRequire.extensions['.css'] = (loadedModule, filename) => {
  if (filename.toLowerCase() !== stylesPath) {
    if (previousCssLoader) return previousCssLoader(loadedModule, filename);
    throw new Error(`Unexpected CSS import in trade outcome render test: ${filename}`);
  }
  const classNames = [...readFileSync(filename, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
  loadedModule.exports = Object.fromEntries([...new Set(classNames)].map((name) => [name, `test-${name}`]));
};
after(() => {
  if (previousCssLoader) testRequire.extensions['.css'] = previousCssLoader;
  else delete testRequire.extensions['.css'];
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

const WALLET = '0x1111111111111111111111111111111111111111';
const ROUTER = '0x33636D49FbefBE798e15e7F356E8DBef543CC708';

function opened(market: 'ETH' | 'BTC', side: 'long' | 'short', details: PlannedRoute['details']): PlannedRoute {
  return {
    operation: 'increasePosition', walletAddress: WALLET, chainId: 1,
    transactions: [{ chainId: 1, from: WALLET, to: ROUTER, data: '0xef9e1aa700', value: 0n, kind: 'action', operation: 'increasePosition' }],
    policy: { walletAddress: WALLET, chainId: 1, reviewedAction: {
      kind: 'position-increase', poolAddress: positionPoolAddress(market, side), positionType: side, positionId: 0,
      inputTokenAddress: FX_TOKENS.ETH.address, inputAmount: 10n ** 18n, nativeInput: true,
      collateralTokenAddress: positionCollateralTokenAddress(market, side), debtTokenAddress: positionDebtTokenAddress(market, side),
    } },
    details,
  };
}

/** Rows as [label, visible text of the value], from rendered markup. */
function rows(html: string) {
  return [...html.matchAll(/<div class="test-row" data-outcome-fact="([^"]+)"><dt>[^<]*<\/dt><dd>(.*?)<\/dd><\/div>/g)]
    .map((match) => [match[1], match[2].replace(/<[^>]*>/g, '')]);
}

test('while the warm-up runs, the same rows hold their place with announced-off placeholders', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview, { market: 'ETH', side: 'long', route: null }));
  assert.match(html, /^<div class="test-outcome" role="group" aria-label="Estimated position" aria-busy="true" data-trade-outcome="pending">/);
  assert.deepEqual(rows(html).map(([label]) => label), ['Estimated collateral', 'Estimated debt', 'Protocol fee rate']);
  for (const label of ['Loading estimated collateral', 'Loading estimated debt', 'Loading protocol fee rate']) {
    assert.match(html, new RegExp(`role="status" aria-live="off" aria-label="${label}"`));
  }
  // No price snapshot in this render: no USD line is reserved, so none can appear and push the rows.
  assert.doesNotMatch(html, /Loading USD value/);
});

test('a settled route shows the review’s figures, each marked as an estimate, with the exact value on hover', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  const route = opened('ETH', 'long', {
    colls: '1500000000000000000', debts: '1010218412345678901234',
    protocolFeeQuote: { poolAddress: positionPoolAddress('ETH', 'long'), routerAddress: ROUTER, ratios: ['3000000', '0', '0', '0'] },
  });
  const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview, { market: 'ETH', side: 'long', route }));
  assert.match(html, /data-trade-outcome="ready"/);
  assert.doesNotMatch(html, /aria-busy/);
  // "1.5 wstETH" is exact in the review; the ticket still marks it as an estimate. The rate is the pool's quoted rate.
  // Without a wstETH rate read beside the quote, the collateral keeps its native unit.
  assert.deepEqual(rows(html), [
    ['Estimated collateral', '≈ 1.5 wstETH'],
    ['Estimated debt', '≈ 1,010.21841234 fxUSD'],
    ['Protocol fee rate', '0.3%'],
  ]);
  assert.match(html, /title="1010\.218412345678901234 fxUSD"/);
  // With it (as every planned ETH long carries), the position's own stETH accounting.
  const converted = renderToStaticMarkup(React.createElement(TradeOutcomePreview, {
    market: 'ETH', side: 'long', route: { ...route, details: { ...route.details, stEthPerWstEth: '1200000000000000000' } },
  }));
  assert.deepEqual(rows(converted)[0], ['Estimated collateral', '≈ 1.8 stETH']);
  assert.match(converted, /title="1\.8 stETH \(1\.5 wstETH at 1\.2 stETH per wstETH\)"/);
});

test('a short previews fxUSD collateral and the borrowed derivative, and an unreadable fee says so as the review does', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  const html = renderToStaticMarkup(React.createElement(TradeOutcomePreview, {
    market: 'BTC', side: 'short', route: opened('BTC', 'short', { colls: '1234500000000000000000', debts: '123456780000000000' }),
  }));
  assert.deepEqual(rows(html), [
    ['Estimated collateral', '≈ 1,234.5 fxUSD'],
    ['Estimated debt', '≈ 0.12345678 WBTC'],
    ['Protocol fee rate', 'Unavailable'],
  ]);
});

test('a route the review could not describe shows nothing at all', async () => {
  const { TradeOutcomePreview } = await import('../src/components/TradeOutcomePreview');
  assert.equal(renderToStaticMarkup(React.createElement(TradeOutcomePreview, { market: 'ETH', side: 'long', route: opened('ETH', 'long', {}) })), '');
});
