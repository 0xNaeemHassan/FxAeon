import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Match the isolated JSX/CSS loader used by the position-card render tests.
const globalReact = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globalReact.React;
globalReact.React = React;
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions['.css'];
const stylesPaths = new Set(['LeverageSplit', 'PageSections', 'YieldFlow', 'trade-surfaces', 'AmountField'].map((name) =>
  fileURLToPath(new URL(`../src/components/${name}.module.css`, import.meta.url)).toLowerCase()));
testRequire.extensions['.css'] = (loadedModule, filename) => {
  if (!stylesPaths.has(filename.toLowerCase())) {
    if (previousCssLoader) return previousCssLoader(loadedModule, filename);
    throw new Error(`Unexpected CSS import in leverage split render test: ${filename}`);
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

function splitRows(html: string) {
  return [...html.matchAll(/<li[^>]*style="--borrowed:([^"]+)"[^>]*>(.*?)<\/li>/g)].map((match) => ({
    borrowed: Number(match[1]),
    text: match[2].replace(/<[^>]+>/g, ''),
  }));
}

test('long illustrations preserve collateral-based leverage and rounded labels', async () => {
  const { LeverageSplit } = await import('../src/components/LeverageSplit');
  const html = renderToStaticMarkup(React.createElement(LeverageSplit, { side: 'long', max: 6, debtLabel: 'minted fxUSD' }));
  const rows = splitRows(html);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].borrowed, 1 / 2);
  assert.equal(rows[1].borrowed, 2 / 3);
  assert.equal(rows[1].text, '3×67% minted fxUSD · 33% yours');
  assert.equal(rows[2].borrowed, 5 / 6);
  assert.equal(rows[2].text, '6.0× · pool maximum83% minted fxUSD · 17% yours');
});

test('short illustrations use borrowed exposure over equity for 2×, 3×, and 6×', async () => {
  const { LeverageSplit } = await import('../src/components/LeverageSplit');
  const html = renderToStaticMarkup(React.createElement(LeverageSplit, { side: 'short', max: 6, debtLabel: 'borrowed wstETH' }));
  assert.match(html, /aria-label="Share of a position that is borrowed wstETH, by leverage, before fees"/);
  const rows = splitRows(html);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].borrowed, 2 / 3);
  assert.equal(rows[1].borrowed, 3 / 4);
  assert.equal(rows[1].text, '3×75% borrowed wstETH · 25% yours');
  assert.equal(rows[2].borrowed, 6 / 7);
  assert.ok(Math.abs((1 - rows[2].borrowed) - 1 / 7) < Number.EPSILON);
  assert.equal(rows[2].text, '6.0× · pool maximum86% borrowed wstETH · 14% yours');
});

test('unavailable or low pool maxima keep finite illustrative rows without a false maximum', async () => {
  const { LeverageSplit } = await import('../src/components/LeverageSplit');
  for (const side of ['long', 'short'] as const) {
    for (const max of [undefined, 0, -1, 0.1, 1, 3, Number.NaN, Infinity, -Infinity]) {
      const html = renderToStaticMarkup(React.createElement(LeverageSplit, { side, max, debtLabel: 'debt' }));
      const rows = splitRows(html);
      assert.equal(rows.length, 2, `${side} with max ${max}`);
      assert.doesNotMatch(html, /pool maximum|NaN|Infinity/);
      for (const row of rows) assert.ok(Number.isFinite(row.borrowed) && row.borrowed >= 0 && row.borrowed <= 1);
      assert.equal(rows[1].borrowed, side === 'long' ? 2 / 3 : 3 / 4);
    }
  }
});

test('Trade education passes the selected direction and keeps its copy consistent with the bars', async () => {
  const { TradeSections } = await import('../src/components/ProductSections');
  for (const market of ['ETH', 'BTC'] as const) {
    for (const side of ['long', 'short', 'long'] as const) {
      const html = renderToStaticMarkup(React.createElement(TradeSections, {
        market, side, leverage: { min: side === 'long' ? 1.1 : 0.1, max: 6 },
        openPositions: null, positionsStatus: 'disconnected',
      }));
      const rows = splitRows(html);
      assert.match(html, /role="radiogroup" aria-label="Leverage example"/);
      assert.match(html, new RegExp(`role="radio" aria-label="${side === 'long' ? 'Long' : 'Short'}" aria-checked="true"`));
      assert.equal(rows[1].borrowed, side === 'long' ? 2 / 3 : 3 / 4);
      if (side === 'long') {
        assert.match(html, /a 3× long is two thirds minted fxUSD and one third yours/);
        assert.equal(rows[1].text, '3×67% minted fxUSD · 33% yours');
      } else {
        assert.match(html, /a 3× short is three quarters borrowed and one quarter yours/);
        assert.equal(rows[1].text, `3×75% borrowed ${market === 'ETH' ? 'wstETH' : 'WBTC'} · 25% yours`);
      }
    }
  }
});
