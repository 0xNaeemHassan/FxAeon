import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hex } from 'viem';
import { classifyActivity } from '../src/lib/activityClassification';
import { FX_ROUTER_ADDRESS, positionPoolAddress } from '../src/lib/fx/policy';
import type { PlannedTransaction, TransactionExecutionResult } from '../src/lib/fx/types';
import { openedPositionTitle, positionName } from '../src/lib/positionNaming';
import { resultPresentation } from '../src/components/review/executionResult';

const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const HASH = `0x${'a'.repeat(64)}` as Hex;

function confirmedOpen(status: TransactionExecutionResult['status'] = 'confirmed'): TransactionExecutionResult {
  return {
    status, operation: 'increasePosition', chainId: 1, walletAddress: WALLET,
    steps: [{ index: 0, transaction: { kind: 'action' } as PlannedTransaction, hash: HASH, status: status === 'confirmed' ? 'confirmed' : 'failed', receipt: { status: 'success' } as never }],
  };
}

test('the result, the row and History name a newly opened position with one verb', () => {
  for (const [market, side, name] of [['ETH', 'long', 'ETH Long'], ['BTC', 'short', 'BTC Short']] as const) {
    const title = openedPositionTitle(market, side);
    assert.equal(title, `Opened ${name}`);
    // The row's identity line.
    assert.equal(positionName(market, side), name);
    // The confirmed result.
    assert.equal(resultPresentation(confirmedOpen(), false, title).title, title);
    // History, from the journal entry Trade wrote and the minted position NFT.
    const history = classifyActivity({
      chainId: 1, hash: HASH, timestamp: 1, wallet: WALLET, status: 'confirmed', transfers: [],
      journal: { intent: 'Open position', operation: 'increasePosition', stepKind: 'action', to: FX_ROUTER_ADDRESS },
      nfts: [{ pool: positionPoolAddress(market, side), tokenId: 42n, direction: 'in', counterparty: FX_ROUTER_ADDRESS }],
    });
    assert.equal(history.kind, 'open');
    assert.equal(history.title, title);
    // A sentence keeps its own case.
    assert.match(history.summary, new RegExp(`^You opened an? ${market} ${side}`));
  }
});

test('only a fully confirmed result takes the opened title', () => {
  assert.equal(resultPresentation(confirmedOpen(), false).title, 'Confirmed');
  for (const status of ['partial', 'failed'] as const) {
    const unfinished = confirmedOpen(status);
    assert.notEqual(resultPresentation(unfinished, false, 'Opened ETH Long').title, 'Opened ETH Long');
    assert.equal(resultPresentation(unfinished, false, 'Opened ETH Long').title, resultPresentation(unfinished, false).title);
  }
  assert.equal(resultPresentation(confirmedOpen(), true, 'Opened ETH Long').title, 'Confirmed on source');
});
