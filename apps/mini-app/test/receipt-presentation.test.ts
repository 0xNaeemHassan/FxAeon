import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { buildReceiptPresentation, receiptTransfersFromLogs, verifiedReceiptPositionIdentity } from '../src/lib/receiptPresentation';

const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

test('formats only registry-known Ethereum receipt transfers as token amounts', () => {
  const result = buildReceiptPresentation({ chainId: 1, walletAddress: WALLET, status: 'success',
    transfers: [{ token: FX_TOKENS.USDC.address, from: OTHER, to: WALLET, amountRaw: 1_234_500n }],
    executionCostWei: 2_100_000_000_000_000n, nativeValueWei: 1_000_000_000_000_000_000n,
  });
  assert.deepEqual(result.movements, ['received 1.2345 USDC']);
  assert.equal(result.executionFee, '0.0021 ETH');
  assert.equal(result.nativeValue, '1 ETH');
  assert.equal(result.feeCaveat, null);
});

test('keeps unknown chain tokens technical and labels Base execution fee exclusions', () => {
  const result = buildReceiptPresentation({ chainId: 8453, walletAddress: WALLET, status: 'success',
    transfers: [{ token: '0x3333333333333333333333333333333333333333', from: WALLET, to: OTHER, amountRaw: 9n }],
    executionCostWei: 42n,
  });
  assert.deepEqual(result.movements, ['Token movement available in technical details']);
  assert.match(result.technicalMovements[0] ?? '', /9 base units/);
  assert.equal(result.feeLabel, 'Execution fee');
  assert.match(result.feeCaveat ?? '', /L1 and operator fees/);
});

test('reverted receipts show no token movement or native value', () => {
  const result = buildReceiptPresentation({ chainId: 1, walletAddress: WALLET, status: 'reverted',
    transfers: [{ token: FX_TOKENS.USDC.address, from: OTHER, to: WALLET, amountRaw: 100n }], nativeValueWei: 1n,
  });
  assert.deepEqual(result.movements, []);
  assert.equal(result.nativeValue, null);
});

test('receipt log decoder rejects malformed indexed addresses and self-transfers', () => {
  const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const padded = `0x${'0'.repeat(24)}${WALLET.slice(2)}`;
  const validLog = { address: FX_TOKENS.USDC.address, topics: [topic, padded, padded], data: `0x${'0'.repeat(63)}1` };
  assert.deepEqual(receiptTransfersFromLogs([validLog], WALLET), []);
  assert.deepEqual(receiptTransfersFromLogs([{ ...validLog, topics: [topic, `0x${'1'.repeat(24)}${WALLET.slice(2)}`, padded] }], WALLET), []);
});

test('position identity is shown only for the matching confirmed verified receipt hint', () => {
  const hint = { market: 'ETH' as const, side: 'long' as const, positionId: 27, transactionHash: `0x${'a'.repeat(64)}` as `0x${string}` };
  assert.deepEqual(verifiedReceiptPositionIdentity({ status: 'confirmed', verification: 'receipt', transactionHash: hint.transactionHash, hint }), hint);
  assert.equal(verifiedReceiptPositionIdentity({ status: 'pending', verification: 'receipt', transactionHash: hint.transactionHash, hint }), null);
  assert.equal(verifiedReceiptPositionIdentity({ status: 'confirmed', verification: 'rpc-error', transactionHash: hint.transactionHash, hint }), null);
  assert.equal(verifiedReceiptPositionIdentity({ status: 'confirmed', verification: 'receipt', transactionHash: `0x${'b'.repeat(64)}`, hint }), null);
});
