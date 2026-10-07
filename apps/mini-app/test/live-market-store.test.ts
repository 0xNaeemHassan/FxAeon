import assert from 'node:assert/strict';
import test from 'node:test';
import { LIVE_QUOTE_MAX_AGE_MS, isLiveQuoteFresh, type LiveQuote } from '../src/lib/liveMarket';
import { liveMarketStore } from '../src/lib/liveMarketStore';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
function quote(market: 'ETH' | 'BTC', sequence: number): LiveQuote {
  return {
    market, productId: market === 'ETH' ? 'ETH-USD' : 'BTC-USD',
    price: market === 'ETH' ? 2400 : 104000,
    open24h: 2300, high24h: 105000, low24h: 2200, percentChange24h: 1,
    sequence, sourceAt: Date.now(), receivedAt: Date.now(), source: 'coinbase',
  };
}

test('live quotes keep unaffected market snapshots stable while preserving expiry and updates', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  liveMarketStore.setStatus('live');
  liveMarketStore.acceptQuote(quote('ETH', 1));
  liveMarketStore.acceptQuote(quote('BTC', 1));
  t.mock.timers.tick(0);
  const initialEth = liveMarketStore.getSnapshot('ETH');
  const initialBtc = liveMarketStore.getSnapshot('BTC');
  assert.equal(isLiveQuoteFresh(initialEth.quote, initialEth.now), true);
  let ethRevisions = 0;
  let btcRevisions = 0;
  let previousEth = initialEth;
  let previousBtc = initialBtc;
  const stop = liveMarketStore.subscribe(() => {
    const eth = liveMarketStore.getSnapshot('ETH');
    const btc = liveMarketStore.getSnapshot('BTC');
    if (eth !== previousEth) ethRevisions += 1;
    if (btc !== previousBtc) btcRevisions += 1;
    previousEth = eth;
    previousBtc = btc;
  });
  try {
    for (let sequence = 2; sequence <= 21; sequence += 1) {
      t.mock.timers.tick(300);
      liveMarketStore.acceptQuote(quote('BTC', sequence));
      t.mock.timers.tick(0);
    }
    assert.equal(btcRevisions, 20, 'every published BTC quote remains observable');
    assert.equal(ethRevisions, 0, 'BTC-only ticks must not trigger ETH useSyncExternalStore renders');
    assert.equal(liveMarketStore.getSnapshot('ETH'), initialEth);

    const beforeReplay = liveMarketStore.getSnapshot('BTC');
    liveMarketStore.acceptQuote(quote('BTC', 21));
    liveMarketStore.acceptQuote(quote('BTC', 20));
    t.mock.timers.tick(250);
    assert.equal(liveMarketStore.getSnapshot('BTC'), beforeReplay);

    // ETH expires first while BTC remains current. Its expiry must not force
    // a BTC render, and the later BTC expiry must still be scheduled.
    t.mock.timers.tick(LIVE_QUOTE_MAX_AGE_MS - 6250 + 1);
    const expiredEth = liveMarketStore.getSnapshot('ETH');
    assert.equal(isLiveQuoteFresh(expiredEth.quote, expiredEth.now), false);
    assert.equal(ethRevisions, 1);
    assert.equal(liveMarketStore.getSnapshot('BTC'), beforeReplay);
    t.mock.timers.tick(6000);
    assert.equal(isLiveQuoteFresh(liveMarketStore.getSnapshot('BTC').quote, liveMarketStore.getSnapshot('BTC').now), false);
    assert.equal(btcRevisions, 21);

    // Status changes must still reach both instruments immediately.
    liveMarketStore.setStatus('reconnecting');
    assert.equal(liveMarketStore.getSnapshot('ETH').status, 'reconnecting');
    assert.equal(liveMarketStore.getSnapshot('BTC').status, 'reconnecting');
    const unchanged = liveMarketStore.getSnapshot('ETH');
    liveMarketStore.setStatus('reconnecting');
    assert.equal(liveMarketStore.getSnapshot('ETH'), unchanged);
    liveMarketStore.setStatus('live');
    liveMarketStore.acceptQuote(quote('ETH', 2));
    t.mock.timers.tick(0);
    assert.equal(isLiveQuoteFresh(liveMarketStore.getSnapshot('ETH').quote, liveMarketStore.getSnapshot('ETH').now), true);
    assert.equal(liveMarketStore.getSnapshot('BTC').quote?.sequence, 21);

    const ethBeforeBurst = ethRevisions;
    const btcBeforeBurst = btcRevisions;
    for (let sequence = 3; sequence <= 102; sequence += 1) {
      liveMarketStore.acceptQuote(quote('ETH', sequence));
    }
    t.mock.timers.tick(249);
    assert.equal(ethRevisions, ethBeforeBurst, 'a burst retains the existing 250 ms publish cap');
    t.mock.timers.tick(1);
    assert.equal(ethRevisions, ethBeforeBurst + 1);
    assert.equal(liveMarketStore.getSnapshot('ETH').quote?.sequence, 102);
    assert.equal(btcRevisions, btcBeforeBurst, 'an already stale BTC snapshot stays stable');
    t.mock.timers.tick(LIVE_QUOTE_MAX_AGE_MS + 1);
    assert.equal(isLiveQuoteFresh(liveMarketStore.getSnapshot('ETH').quote, liveMarketStore.getSnapshot('ETH').now), false);
    const afterExpiry = ethRevisions;
    t.mock.timers.tick(LIVE_QUOTE_MAX_AGE_MS * 3);
    assert.equal(ethRevisions, afterExpiry, 'expired quotes do not create repeated expiry notifications');
  } finally {
    stop();
  }
});

test('a quote that expires while listeners render still goes stale', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW + 3_600_000 });
  liveMarketStore.setStatus('live');
  liveMarketStore.acceptQuote(quote('ETH', 1_000));
  t.mock.timers.tick(1);
  liveMarketStore.acceptQuote(quote('BTC', 1_000));
  t.mock.timers.tick(250);
  // A slow render: the clock moves on while listeners run, past BTC's expiry,
  // which falls one millisecond after ETH's.
  const stop = liveMarketStore.subscribe(() => t.mock.timers.setTime(Date.now() + 5));
  try {
    t.mock.timers.tick(LIVE_QUOTE_MAX_AGE_MS - 250);
    t.mock.timers.tick(0);
    const eth = liveMarketStore.getSnapshot('ETH');
    const btc = liveMarketStore.getSnapshot('BTC');
    assert.equal(isLiveQuoteFresh(eth.quote, eth.now), false);
    assert.equal(isLiveQuoteFresh(btc.quote, btc.now), false, 'BTC expiry must not be skipped');
  } finally {
    stop();
  }
});
