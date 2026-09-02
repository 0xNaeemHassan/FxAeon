import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PositionInfo } from '@aladdindao/fx-sdk';
import {
  createPositionReadGuard,
  mergeVerifiedPositions,
  newlyVerifiedPositions,
  POSITION_GROUPS,
  positionDisplayLeverage,
  positionIsStale,
  settlePositionGroups,
  unavailablePositionResult,
  type PositionGroup,
  type PositionReadResult,
  type UiPosition,
} from '../src/app/trade/fxUi';

const WAD = 10n ** 18n;

function position(positionId: number, overrides: Partial<PositionInfo> = {}): PositionInfo {
  return {
    positionId,
    rawColls: WAD,
    rawDebts: WAD / 2n,
    currentLeverage: 2,
    lsdLeverage: 2,
    rawCollsToken: 'wstETH',
    rawDebtsToken: 'fxUSD',
    rawCollsDecimals: 18,
    rawDebtsDecimals: 18,
    ...overrides,
  };
}

function key(group: PositionGroup): string {
  return `${group.market}:${group.side}`;
}

function uiPosition(group: PositionGroup, positionId: number): UiPosition {
  return { ...group, info: position(positionId) };
}

test('position groups settle independently and preserve verified positions after a partial failure', async () => {
  const calls: string[] = [];
  const result = await settlePositionGroups(async (group) => {
    calls.push(key(group));
    if (group.market === 'ETH' && group.side === 'short') {
      throw new Error('ETH short pool unavailable');
    }
    const id = POSITION_GROUPS.findIndex((candidate) => key(candidate) === key(group)) + 1;
    return [position(id)];
  });

  assert.deepEqual(calls, ['ETH:long', 'ETH:short', 'BTC:long', 'BTC:short']);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.failedGroups.map(key), ['ETH:short']);
  assert.deepEqual(result.successfulGroups.map(key), ['ETH:long', 'BTC:long', 'BTC:short']);
  assert.deepEqual(result.positions.map((item) => `${key(item)}:#${item.info.positionId}`), [
    'ETH:long:#1',
    'BTC:long:#3',
    'BTC:short:#4',
  ]);
  assert.match(String(result.failedGroups[0].reason), /ETH short pool unavailable/);
});

test('position output order is deterministic even when groups resolve out of order', async () => {
  const delays: Record<string, number> = {
    'ETH:long': 12,
    'ETH:short': 8,
    'BTC:long': 4,
    'BTC:short': 0,
  };
  const result = await settlePositionGroups(async (group) => {
    await new Promise((resolve) => setTimeout(resolve, delays[key(group)]));
    const id = POSITION_GROUPS.findIndex((candidate) => key(candidate) === key(group)) + 1;
    return [position(id)];
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.positions.map((item) => key(item)), [
    'ETH:long',
    'ETH:short',
    'BTC:long',
    'BTC:short',
  ]);
  assert.deepEqual(result.failedGroups, []);
});

test('zeroed closed records are omitted without affecting other records in the same group', async () => {
  const result = await settlePositionGroups(async (group) => group.market === 'ETH' && group.side === 'long'
    ? [
        position(1, { rawColls: 0n, rawDebts: 0n, currentLeverage: 0, lsdLeverage: 0 }),
        position(2),
      ]
    : []);

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.positions.map((item) => item.info.positionId), [2]);
});

test('a total outage is distinguishable from an honestly empty portfolio', async () => {
  const unavailable = await settlePositionGroups(async (group) => {
    throw new Error(`${key(group)} unavailable`);
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.positions.length, 0);
  assert.equal(unavailable.successfulGroups.length, 0);
  assert.deepEqual(unavailable.failedGroups.map(key), ['ETH:long', 'ETH:short', 'BTC:long', 'BTC:short']);

  const empty = await settlePositionGroups(async () => []);
  assert.equal(empty.status, 'ready');
  assert.equal(empty.positions.length, 0);
  assert.equal(empty.successfulGroups.length, 4);
  assert.equal(empty.failedGroups.length, 0);
});

test('partial refresh replaces successful groups and retains failed groups from the last verified snapshot', () => {
  const previous = [
    uiPosition({ market: 'ETH', side: 'long' }, 1),
    uiPosition({ market: 'ETH', side: 'short' }, 2),
    uiPosition({ market: 'BTC', side: 'long' }, 3),
  ];
  const result: PositionReadResult = {
    positions: [
      uiPosition({ market: 'ETH', side: 'long' }, 4),
      uiPosition({ market: 'BTC', side: 'short' }, 5),
    ],
    successfulGroups: [
      { market: 'ETH', side: 'long' },
      { market: 'BTC', side: 'long' },
      { market: 'BTC', side: 'short' },
    ],
    failedGroups: [{ market: 'ETH', side: 'short', reason: new Error('offline') }],
    status: 'partial',
  };

  const merged = mergeVerifiedPositions(previous, result);
  assert.deepEqual(merged.map((item) => `${key(item)}:#${item.info.positionId}`), [
    'ETH:long:#4',
    'ETH:short:#2',
    'BTC:short:#5',
  ]);
  assert.deepEqual(newlyVerifiedPositions(previous, result).map((item) => item.info.positionId), [4, 5]);
  assert.deepEqual(
    newlyVerifiedPositions(previous, result, [{ market: 'BTC', side: 'long' }]),
    [],
    'a group without a verified pre-refresh baseline must not produce a minted-ID claim',
  );
});

test('an honestly empty successful group clears old positions while a total outage retains the snapshot', () => {
  const previous = [uiPosition({ market: 'ETH', side: 'long' }, 1)];
  const emptyReady: PositionReadResult = {
    positions: [],
    successfulGroups: [...POSITION_GROUPS],
    failedGroups: [],
    status: 'ready',
  };
  assert.deepEqual(mergeVerifiedPositions(previous, emptyReady), []);

  const unavailable: PositionReadResult = {
    positions: [],
    successfulGroups: [],
    failedGroups: POSITION_GROUPS.map((group) => ({ ...group, reason: new Error('offline') })),
    status: 'unavailable',
  };
  assert.deepEqual(mergeVerifiedPositions(previous, unavailable), previous);
  assert.deepEqual(newlyVerifiedPositions(previous, unavailable), []);
});

test('chain-level read failure marks every retained pool as last verified', () => {
  const previous = POSITION_GROUPS.map((group, index) => uiPosition(group, index + 1));
  const reason = new Error('RPC chain verification failed');
  const result = unavailablePositionResult(reason);
  const retained = mergeVerifiedPositions(previous, result);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(retained, previous);
  assert.ok(retained.every((item) => positionIsStale(item, result.failedGroups)));
  assert.ok(result.failedGroups.every((group) => group.reason === reason));
  assert.deepEqual(newlyVerifiedPositions(previous, result), []);
});

test('position leverage uses side-specific SDK semantics and rejects invalid values', () => {
  const info = position(1, { currentLeverage: 1.5, lsdLeverage: 0.5 });
  assert.deepEqual(positionDisplayLeverage({ market: 'ETH', side: 'long', info }), { value: 1.5, label: 'leverage' });
  assert.deepEqual(positionDisplayLeverage({ market: 'ETH', side: 'short', info }), { value: 0.5, label: 'LSD leverage' });
  assert.equal(positionDisplayLeverage({ market: 'BTC', side: 'short', info: { ...info, lsdLeverage: NaN } }).value, null);
  assert.equal(positionDisplayLeverage({ market: 'BTC', side: 'long', info: { ...info, currentLeverage: -1 } }).value, null);
});

test('late and superseded position reads cannot update a wallet session', async () => {
  const guard = createPositionReadGuard();
  const oldRequest = guard.begin()!;
  const newRequest = guard.begin()!;
  assert.equal(guard.isCurrent(oldRequest), false);
  assert.equal(guard.isCurrent(newRequest), true);

  const pending = Promise.resolve().then(() => guard.isCurrent(newRequest));
  guard.invalidate();
  assert.equal(await pending, false, 'a response arriving after wallet change/unmount is discarded');
  assert.equal(guard.begin(), null, 'retained callbacks must not restart the old account read');

  guard.activate();
  const remountedRequest = guard.begin()!;
  assert.equal(guard.isCurrent(newRequest), false, 'StrictMode remount cannot revive a previous read');
  assert.equal(guard.isCurrent(remountedRequest), true);
});
