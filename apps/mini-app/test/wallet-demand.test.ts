import assert from 'node:assert/strict';
import test from 'node:test';
import { createWalletDemandRegistry, walletDemandForPathname } from '../src/lib/walletDemand';

test('portfolio is the only route that starts expanded cross-chain asset discovery', () => {
  assert.deepEqual(walletDemandForPathname('/portfolio'), {
    enabled: true, expandedAssets: true, chainPulse: true, positions: true,
  });
  assert.deepEqual(walletDemandForPathname('/portfolio/details'), {
    enabled: true, expandedAssets: true, chainPulse: true, positions: true,
  });
});

test('position consumers activate only pulse and position demand', () => {
  for (const pathname of ['/trade', '/borrow', '/positions', '/positions/123']) {
    assert.deepEqual(walletDemandForPathname(pathname), {
      enabled: true, expandedAssets: false, chainPulse: true, positions: true,
    });
  }
});

test('exact wallet consumers do not start expanded assets, pulse, or positions', () => {
  for (const pathname of ['/earn', '/move', '/earn/redeem']) {
    assert.deepEqual(walletDemandForPathname(pathname), {
      enabled: true, expandedAssets: false, chainPulse: false, positions: false,
    });
  }
});

test('informational routes keep wallet feeds disabled', () => {
  for (const pathname of ['/', '/activity', '/settings', '/docs', '/qr']) {
    assert.deepEqual(walletDemandForPathname(pathname), {
      enabled: false, expandedAssets: false, chainPulse: false, positions: false,
    });
  }
});

test('an open wallet profile registers expanded assets and positions on an informational route', () => {
  const registry = createWalletDemandRegistry(walletDemandForPathname('/settings'));
  const unregister = registry.register({ expandedAssets: true, chainPulse: true, positions: true });
  assert.deepEqual(registry.getDemand(), {
    enabled: true, expandedAssets: true, chainPulse: true, positions: true,
  });
  unregister();
  assert.deepEqual(registry.getDemand(), {
    enabled: false, expandedAssets: false, chainPulse: false, positions: false,
  });
});

test('multiple profile consumers deduplicate effective demand and clean up independently', () => {
  const registry = createWalletDemandRegistry(walletDemandForPathname('/activity'));
  const first = registry.register({ expandedAssets: true, chainPulse: true, positions: true });
  const second = registry.register({ expandedAssets: true, chainPulse: true, positions: true });
  assert.deepEqual(registry.getDemand(), {
    enabled: true, expandedAssets: true, chainPulse: true, positions: true,
  });
  first();
  assert.equal(registry.getDemand().expandedAssets, true);
  second();
  assert.deepEqual(registry.getDemand(), {
    enabled: false, expandedAssets: false, chainPulse: false, positions: false,
  });
});

test('route changes remove route-owned demand while preserving active consumer demand', () => {
  const registry = createWalletDemandRegistry(walletDemandForPathname('/portfolio'));
  const unregister = registry.register({ expandedAssets: true, chainPulse: true, positions: true });
  registry.setRouteDemand(walletDemandForPathname('/settings'));
  assert.deepEqual(registry.getDemand(), {
    enabled: true, expandedAssets: true, chainPulse: true, positions: true,
  });
  unregister();
  assert.deepEqual(registry.getDemand(), {
    enabled: false, expandedAssets: false, chainPulse: false, positions: false,
  });
});
