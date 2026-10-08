import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UiPosition } from '../src/app/trade/fxUi';
import type { PositionBrakeEntry, PositionBrakeStore } from '../src/components/PositionBrakeContext';

// Several legacy JSX-only leaf components are transformed for Next's browser
// bundle and expect a global React binding under this CJS smoke-test runner.
// Keep the compatibility shim isolated to this test process.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const positionCardStylesPath = fileURLToPath(new URL('../src/components/ProtocolPositionCard.module.css', import.meta.url));

/** Render with the real card module, exposing its CSS module class names under SSR. */
async function withCardModule<T>(run: (modules: {
  card: typeof import('../src/components/ProtocolPositionCard');
  brake: typeof import('../src/components/PositionBrakeContext');
}) => T | Promise<T>): Promise<T> {
  const previousCssLoader = testRequire.extensions['.css'];
  try {
    // tsx runs this focused source test through CommonJS; teach only that
    // loader how to expose this CSS module's class names during SSR.
    testRequire.extensions['.css'] = (loadedModule, filename) => {
      if (filename.toLowerCase() !== positionCardStylesPath.toLowerCase()) {
        if (previousCssLoader) return previousCssLoader(loadedModule, filename);
        throw new Error(`Unexpected CSS import in position card render test: ${filename}`);
      }

      const source = readFileSync(filename, 'utf8');
      const classNames = [...source.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
      loadedModule.exports = Object.fromEntries([...new Set(classNames)].map((name) => [name, `test-${name}`]));
    };
    return await run({
      card: await import('../src/components/ProtocolPositionCard'),
      brake: await import('../src/components/PositionBrakeContext'),
    });
  } finally {
    if (previousCssLoader) testRequire.extensions['.css'] = previousCssLoader;
    else delete testRequire.extensions['.css'];
  }
}

test.after(() => {
  if (previousReact) globalReact.React = previousReact;
  else Reflect.deleteProperty(globalThis, 'React');
});

const E18 = 10n ** 18n;
const ethLong: UiPosition = {
  market: 'ETH',
  side: 'long',
  info: {
    positionId: 42,
    rawColls: E18,
    rawDebts: 5n * 10n ** 17n,
    currentLeverage: 2,
    lsdLeverage: 2,
    rawCollsToken: 'wstETH',
    rawDebtsToken: 'fxUSD',
    rawCollsDecimals: 18,
    rawDebtsDecimals: 18,
  },
};
const btcShort: UiPosition = {
  market: 'BTC',
  side: 'short',
  info: { ...ethLong.info, positionId: 7, rawCollsToken: 'fxUSD', rawDebtsToken: 'WBTC', currentLeverage: 1.5, lsdLeverage: 0.5 },
};

function brakeStore(entries: Record<string, PositionBrakeEntry>): PositionBrakeStore {
  return { entries: new Map(Object.entries(entries)), register: () => () => undefined };
}

function readyEntry(position: UiPosition, debtRatio: bigint, thresholds = { rebalanceRatio: 88n * E18 / 100n, liquidateRatio: 95n * E18 / 100n }, priceAtRead: number | null = 2_400): PositionBrakeEntry {
  return {
    record: {
      reading: { side: position.side, debtRatio, ...thresholds, priceAtRead },
      readAt: Date.now(),
      rawColls: position.info.rawColls,
      rawDebts: position.info.rawDebts,
    },
    pending: false,
    failed: false,
  };
}

test('server-rendered shared position cards use accessible placeholders and preserve raw units', async () => {
  await withCardModule(({ card: { ProtocolPositionCard } }) => {
    const html = renderToStaticMarkup(React.createElement(ProtocolPositionCard, { position: ethLong }));

    assert.match(html, /Position value/);
    assert.match(html, /aria-label="Loading value"/);
    assert.doesNotMatch(html, /title="—"|Value loading|Price delayed|USD unavailable/);
    assert.match(html, /1 wstETH/);
    assert.match(html, /0\.5 fxUSD/);
    assert.match(html, /Collateral/);
    assert.match(html, /Debt/);
    assert.match(html, /Market price/);
    assert.match(html, /Debt \/ collateral/);
    // The side is a word in its own color, not a pill.
    assert.match(html, /<span class="test-side test-long">Long<\/span>/);
    assert.match(renderToStaticMarkup(React.createElement(ProtocolPositionCard, { position: btcShort })), /<span class="test-side test-short">Short<\/span>/);
    // Without a brake read there is no line, no marker, and no zero.
    assert.doesNotMatch(html, /Rebalances|rebalance point|data-brake-marker/);

    const zeroHtml = renderToStaticMarkup(React.createElement(ProtocolPositionCard, {
      position: { ...ethLong, info: { ...ethLong.info, positionId: 43, rawColls: 0n, rawDebts: 0n } },
    }));
    assert.ok((zeroHtml.match(/\$0\.00/g) ?? []).length >= 3, 'known zero balances stay visible as $0.00');
  });
});

test('a current brake read draws the marker and the plain line, with liquidation for screen readers', async () => {
  await withCardModule(({ card: { ProtocolPositionCard }, brake: { PositionBrakeContext } }) => {
    const render = (position: UiPosition, entry: PositionBrakeEntry, props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(
      PositionBrakeContext.Provider,
      { value: brakeStore({ [`${position.market}:${position.side}:${position.info.positionId}`]: entry }) },
      React.createElement(ProtocolPositionCard, { position, ...props }),
    ));

    const long = render(ethLong, readyEntry(ethLong, 66n * E18 / 100n));
    assert.match(long, /data-position-split="true"[^>]*data-brake="clear"/);
    assert.match(long, /--debt-share:0\.66/);
    assert.match(long, /--rebalance-at:0\.88/);
    assert.match(long, /--liquidate-at:0\.95/);
    assert.match(long, /data-brake-marker="rebalance"/);
    assert.match(long, /data-brake-marker="liquidation"/);
    assert.match(long, /data-position-brake="clear"[^>]*><span>Rebalances if ETH falls ≈ 25% \(≈ \$1,800\)<span class="sr-only"> If rebalancing can’t keep up, liquidation becomes possible once ETH falls ≈ 30% \(≈ \$1,668\)\.<\/span><\/span>/);
    // The bar stays decorative; its words are in the line.
    assert.match(long, /<div class="test-split" aria-hidden="true"/);

    const short = render(btcShort, readyEntry(btcShort, 75n * E18 / 100n, { rebalanceRatio: 90n * E18 / 100n, liquidateRatio: 95n * E18 / 100n }, 81_354.96));
    assert.match(short, /Rebalances if BTC rises ≈ 20% \(≈ \$97,625\)/);

    const noQuote = render(ethLong, readyEntry(ethLong, 66n * E18 / 100n, undefined, null));
    assert.match(noQuote, /Rebalances if ETH falls ≈ 25%<span class="sr-only">/);
  });
});

test('reads in flight reserve the line, and failed or stale reads leave the plain split', async () => {
  await withCardModule(({ card: { ProtocolPositionCard }, brake: { PositionBrakeContext, POSITION_BRAKE_MAX_AGE_MS } }) => {
    const render = (store: PositionBrakeStore, position: UiPosition = ethLong) => renderToStaticMarkup(React.createElement(
      PositionBrakeContext.Provider,
      { value: store },
      React.createElement(ProtocolPositionCard, { position }),
    ));
    const key = 'ETH:long:42';
    const loading = render(brakeStore({}));
    assert.match(loading, /role="status" aria-label="Loading rebalance point"/);
    assert.match(render(brakeStore({ [key]: { record: null, pending: true, failed: false } })), /Loading rebalance point/);

    const failed = render(brakeStore({ [key]: { record: null, pending: false, failed: true } }));
    assert.doesNotMatch(failed, /Loading rebalance point|Rebalances|data-brake-marker|data-brake=/);

    const stale = readyEntry(ethLong, 66n * E18 / 100n);
    stale.record!.readAt -= POSITION_BRAKE_MAX_AGE_MS + 1;
    assert.doesNotMatch(render(brakeStore({ [key]: { ...stale, failed: true } })), /Rebalances|data-brake-marker/);
    // A read for other amounts is not shown for this position.
    const changed = { ...ethLong, info: { ...ethLong.info, rawDebts: 6n * 10n ** 17n } };
    assert.doesNotMatch(render(brakeStore({ [key]: { ...readyEntry(ethLong, 66n * E18 / 100n), failed: true } }), changed), /Rebalances|data-brake-marker/);
    // A position without debt has nothing to brake.
    const noDebt = { ...ethLong, info: { ...ethLong.info, rawDebts: 0n } };
    assert.doesNotMatch(render(brakeStore({})), /Rebalances/);
    assert.doesNotMatch(render(brakeStore({}), noDebt), /Loading rebalance point|Rebalances/);
  });
});

test('at the brake the card warns in plain words and links the f(x) docs where a link may sit', async () => {
  await withCardModule(({ card: { ProtocolPositionCard }, brake: { PositionBrakeContext } }) => {
    const store = brakeStore({ 'ETH:long:42': readyEntry(ethLong, 90n * E18 / 100n) });
    const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(
      PositionBrakeContext.Provider,
      { value: store },
      React.createElement(ProtocolPositionCard, { position: ethLong, ...props }),
    ));
    const article = render();
    assert.match(article, /data-brake="rebalance"/);
    assert.match(article, /data-tone="warn" data-position-brake="rebalance"/);
    assert.match(article, /At the rebalance point\. The protocol may rebalance part of this position\./);
    assert.match(article, /<a href="https:\/\/fxprotocol\.gitbook\.io\/fx-docs\/f-x-protocol-mechanisms\/rebalancing-the-position-liquidation-brake" target="_blank" rel="noopener noreferrer">How rebalancing works/);

    for (const props of [{ href: '/positions?position=ETH%3Along%3A42' }, { onSelect: () => undefined }]) {
      const interactive = render(props);
      assert.match(interactive, /At the rebalance point/);
      assert.match(interactive, /title="How rebalancing works: https:\/\/fxprotocol\.gitbook\.io/);
      // No link inside a card that is itself a link or a button.
      assert.equal((interactive.match(/<a /g) ?? []).length, 'href' in props ? 1 : 0);
    }

    const liquidation = renderToStaticMarkup(React.createElement(
      PositionBrakeContext.Provider,
      { value: brakeStore({ 'ETH:long:42': readyEntry(ethLong, 96n * E18 / 100n) }) },
      React.createElement(ProtocolPositionCard, { position: ethLong }),
    ));
    assert.match(liquidation, /At the liquidation point\. The protocol may liquidate this position\./);
    assert.match(liquidation, /rebalancing-the-position-liquidation-brake\/liquidation-process/);
  });
});

test('the loading card reserves the brake line', async () => {
  await withCardModule(({ card: { ProtocolPositionSkeleton } }) => {
    const html = renderToStaticMarkup(React.createElement(ProtocolPositionSkeleton, { compact: true }));
    assert.match(html, /<p class="test-brake"><span class="skeleton test-brakeSkeleton"><\/span><\/p>/);
  });
});
