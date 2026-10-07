import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { createDocsEntries, searchDocs, searchExcerpt, textFromContent } from '../src/app/docs/docsSearch';
import { OFFICIAL_FX_METHODS } from '../src/lib/fx/types';

const entries = createDocsEntries([
  { id: 'fees', title: 'Fees & slippage', content: createElement('p', null, 'Network speed applies to the built-in wallet. A 0.5% slippage limit is not a fee.') },
  { id: 'earn', title: 'Earn', content: createElement('p', null, 'Queued redemptions wait for cooldown. Claim once ready.') },
  { id: 'wallets', title: 'Wallets', content: createElement('p', null, 'Every transaction requires your approval. Never share private keys.') },
], 'Product guide', '/docs');
entries.push(...createDocsEntries([
  { id: 'sdk-earn', title: 'fxSAVE', content: createElement('div', null, createElement('h3', null, 'getFxSaveBalance'), createElement('p', null, 'Read balanceWei and assetsWei. No signing.')) },
  { id: 'sdk-execution', title: 'Review & execution', content: createElement('p', null, 'Slippage and fees are reviewed before signing.') },
], 'SDK reference', '/docs/sdk'));

test('docs search derives all visible text, including nested JSX and code, without rendering components', () => {
  const example = createElement('example', { code: 'sdk.getPositions()', title: 'Read only' }, ['Hello ', createElement('strong', { key: 'nested' }, 'wallet'), 15]);
  assert.equal(textFromContent(example).replace(/\s+/g, ' ').trim(), 'Read only sdk.getPositions() Hello wallet 15');
  assert.equal(textFromContent(null), '');
  assert.equal(textFromContent(false), '');
});

test('docs search ranks the title first and also searches actual article content across pages', () => {
  assert.deepEqual(searchDocs(entries, 'slippage').map(({ id }) => id), ['fees', 'sdk-execution']);
  assert.equal(searchDocs(entries, 'network speed')[0].href, '/docs#fees');
  assert.equal(searchDocs(entries, 'assetsWei')[0].href, '/docs/sdk#sdk-earn');
  assert.equal(searchDocs(entries, 'GET FX SAVE BALANCE')[0].id, 'sdk-earn');
  assert.equal(searchDocs(entries, 'getfxsavebalance')[0].id, 'sdk-earn');
  assert.equal(searchDocs(entries, 'GETFXSAVEBALANCE')[0].id, 'sdk-earn');
  assert.equal(searchDocs(entries, 'queued cooldown')[0].id, 'earn');
  assert.deepEqual(searchDocs(entries, 'wallet cooldown'), []);
});

test('docs search handles punctuation, empty input and unknown terms without losing the source index', () => {
  assert.equal(searchDocs(entries, 'fees & slippage')[0].id, 'fees');
  assert.deepEqual(searchDocs(entries, '  '), []);
  assert.deepEqual(searchDocs(entries, '!!!'), []);
  assert.deepEqual(searchDocs(entries, 'unmatchedterm'), []);
  assert.equal(entries.length, 5);
});

test('result excerpts include matching content and stay bounded', () => {
  const text = `${'A descriptive sentence. '.repeat(8)}cooldown is a delay before claim. ${'More context. '.repeat(20)}`;
  const excerpt = searchExcerpt(text, 'cooldown');
  assert.match(excerpt, /cooldown/);
  assert.ok(excerpt.length <= 152);
  assert.ok(excerpt.startsWith('…'));
  assert.equal(searchExcerpt('A short note.', 'missing'), 'A short note.');
});

test('public reference documents exactly the locked SDK method surface', () => {
  const article = readFileSync(new URL('../src/app/docs/sdk/SdkArticle.tsx', import.meta.url), 'utf8');
  const methodIds = [...article.matchAll(/<h3 id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(methodIds.sort(), [...OFFICIAL_FX_METHODS].sort());
  for (const phrase of ['1.0.5', 'local patches', 'does not sign or broadcast', 'source receipt alone is not delivery']) {
    assert.ok(article.includes(phrase), `public scope must retain: ${phrase}`);
  }
});

test('all existing product-guide fragments, including recovery, remain addressable', () => {
  const article = readFileSync(new URL('../src/app/docs/ProductArticle.tsx', import.meta.url), 'utf8');
  for (const id of ['overview', 'getting-started', 'access', 'wallets', 'trade', 'positions', 'earn', 'borrow', 'move', 'fees', 'history', 'privacy', 'troubleshooting']) {
    assert.ok(article.includes(`id: '${id}'`), `missing /docs#${id}`);
  }
  assert.match(article, /aliases: \['recovery'\]/);
});


test('visible topic-card descriptions participate in overview search', () => {
  const article = readFileSync(new URL('../src/app/docs/ProductArticle.tsx', import.meta.url), 'utf8');
  // Components without children are intentionally opaque to the index. Keep
  // this JSX tree materialized instead of hiding the copy inside a component.
  assert.match(article, /const topicCards = <div/);
  assert.match(article, /\{topicCards\}/);
  const descriptions = [...article.matchAll(/description: '([^']+)'/g)].map((match) => match[1]);
  assert.equal(descriptions.length, 4);
  const overview = createDocsEntries([
    { id: 'overview', title: 'Overview', content: createElement('div', null, descriptions.map((text, index) => createElement('span', { key: index }, text))) },
  ], 'Product guide', '/docs');
  assert.equal(searchDocs(overview, 'repayments')[0]?.href, '/docs#overview');
  assert.equal(searchDocs(overview, 'Understand ETH and BTC longs')[0]?.href, '/docs#overview');
});

test('fxSAVE instant fee precision stays distinct from pool and router fees', () => {
  const article = readFileSync(new URL('../src/app/docs/sdk/SdkArticle.tsx', import.meta.url), 'utf8');
  const config = article.slice(article.indexOf('<h3 id="getFxSaveConfig"'), article.indexOf('<h3 id="getFxSaveRedeemStatus"'));
  assert.match(config, /instantRedeemFeeRatio<\/code> uses <code>1e18<\/code> precision/);
  assert.match(config, /pool\/router fee ratios at <code>1e9<\/code> precision/);
});

test('deposit docs distinguish validated input from the SDK-calculated base-pool-share floor', () => {
  const article = readFileSync(new URL('../src/app/docs/sdk/SdkArticle.tsx', import.meta.url), 'utf8');
  const deposit = article.slice(article.indexOf('<h3 id="depositFxSave"'), article.indexOf('<h3 id="withdrawFxSave"'));
  assert.match(deposit, /validates the caller&apos;s <code>slippage<\/code> value but ignores the chosen tolerance/);
  assert.match(deposit, /pinned router forwards the SDK-calculated floor to the base pool, where it is checked in base-pool-share units/);
  assert.match(deposit, /not a separately enforced final fxSAVE minimum/);
  assert.match(deposit, /does not guarantee the caller&apos;s selected deposit tolerance/);
  assert.match(deposit, /Direct base-pool deposits have no routed minimum-output floor/);
  assert.doesNotMatch(deposit, /Slippage applies to routed|0\.04%/);
  assert.match(deposit, /fx-sdk\/blob\/53c0b9805a169e75ad375c92c241e1292b66405f\/src\/core\/fxsave\.ts#L332-L474/);
  assert.match(deposit, /SavingFxUSDFacet\.sol#L64-L77/);
  assert.match(deposit, /FxUSDBasePool\.sol#L281-L299/);
});
