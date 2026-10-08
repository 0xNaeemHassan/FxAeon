import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { buildReceiptPresentation, receiptMovementLines, receiptTransfersFromLogs, shouldShowReceiptMovementFallback, verifiedReceiptPositionIdentity } from '../src/lib/receiptPresentation';

const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

test('formats only registry-known Ethereum receipt transfers as token amounts', () => {
  const result = buildReceiptPresentation({ chainId: 1, walletAddress: WALLET, status: 'success', transactionKind: 'action',
    transfers: [{ token: FX_TOKENS.USDC.address, from: OTHER, to: WALLET, amountRaw: 1_234_500n }],
    executionCostWei: 2_100_000_000_000_000n, nativeValueWei: 1_000_000_000_000_000_000n,
  });
  assert.deepEqual(result.movements, ['received 1.2345 USDC']);
  assert.equal(result.executionFee, '0.0021 ETH');
  assert.equal(result.feeLabel, 'Action network fee');
  assert.equal(result.totalExecutionFee, null, 'Ethereum total duplicates its single network fee component');
  assert.equal(result.totalFeeLabel, null);
  assert.equal(result.nativeValue, '1 ETH');
  assert.equal(result.nativeValueLabel, 'Native value sent');
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
  assert.match(result.feeCaveat ?? '', /L1 data, and operator fee component/);
});

test('adds Base L1 data and operator fees to a total only when every component is present', () => {
  const complete = buildReceiptPresentation({ chainId: 8453, status: 'success', transactionKind: 'approval',
    executionCostWei: 1_000_000_000_000_000n, l1DataFeeWei: 2_000_000_000_000_000n, operatorFeeWei: 3_000_000_000_000_000n,
  });
  assert.equal(complete.feeLabel, 'Token approval execution fee');
  assert.equal(complete.executionFee, '0.001 ETH');
  assert.equal(complete.l1DataFee, '0.002 ETH');
  assert.equal(complete.operatorFee, '0.003 ETH');
  assert.equal(complete.totalExecutionFee, '0.006 ETH');
  assert.equal(complete.totalFeeLabel, 'Token approval total execution fee');
  assert.equal(complete.feeCaveat, null);

  const partial = buildReceiptPresentation({ chainId: 8453, status: 'success', transactionKind: 'action',
    executionCostWei: 1_000_000_000_000_000n, l1DataFeeWei: 2_000_000_000_000_000n,
  });
  assert.equal(partial.feeLabel, 'Action execution fee');
  assert.equal(partial.totalExecutionFee, null);
  assert.match(partial.feeCaveat ?? '', /does not include every gas, L1 data, and operator fee component/);
});

test('omits missing movement copy for approval-only receipts but keeps it for actions and unknown kinds', () => {
  const approval = buildReceiptPresentation({ chainId: 1, status: 'success', transactionKind: 'approval' });
  const action = buildReceiptPresentation({ chainId: 1, status: 'success', transactionKind: 'action' });
  const unknown = buildReceiptPresentation({ chainId: 1, status: 'success' });
  assert.equal(shouldShowReceiptMovementFallback([approval]), false);
  assert.equal(shouldShowReceiptMovementFallback([approval, approval]), false);
  assert.equal(shouldShowReceiptMovementFallback([approval, action]), true);
  assert.equal(shouldShowReceiptMovementFallback([unknown]), true);
});

test('labels successful bridge native value as a bridge fee and hides reverted native value', () => {
  const success = buildReceiptPresentation({ chainId: 1, status: 'success', bridgeFee: true, nativeValueWei: 5_000_000_000_000_000n });
  assert.equal(success.nativeValue, '0.005 ETH');
  assert.equal(success.nativeValueLabel, 'Bridge fee');
  const reverted = buildReceiptPresentation({ chainId: 1, status: 'reverted', bridgeFee: true,
    nativeValueWei: 5_000_000_000_000_000n, executionCostWei: 1_000_000_000_000_000n,
  });
  assert.equal(reverted.nativeValue, null);
  assert.equal(reverted.executionFee, '0.001 ETH', 'reverted transactions still show gas actually charged');
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

test('an ETH-paid action with no token log states the ETH it sent as its movement', () => {
  const ethPaid = buildReceiptPresentation({ chainId: 1, walletAddress: WALLET, status: 'success', transactionKind: 'action',
    transfers: [], executionCostWei: 372_000_000_000_000n, nativeValueWei: 500_000_000_000_000_000n,
  });
  assert.deepEqual(receiptMovementLines([ethPaid]), { movements: ['sent 0.5 ETH'], nativeValueIsMovement: true });

  // A token movement is stated as it is, and the native value stays its own line.
  const tokenPaid = buildReceiptPresentation({ chainId: 1, walletAddress: WALLET, status: 'success', transactionKind: 'action',
    transfers: [{ token: FX_TOKENS.USDC.address, from: WALLET, to: OTHER, amountRaw: 2_000_000n }],
    executionCostWei: 1n, nativeValueWei: 500_000_000_000_000_000n,
  });
  assert.deepEqual(receiptMovementLines([tokenPaid]), { movements: ['sent 2 USDC'], nativeValueIsMovement: false });

  // A bridge fee is a fee, not a movement, and nothing at all leaves the list empty for the fallback.
  const bridge = buildReceiptPresentation({ chainId: 1, walletAddress: WALLET, status: 'success', transactionKind: 'action',
    transfers: [], executionCostWei: 1n, nativeValueWei: 1_000_000_000_000_000n, bridgeFee: true,
  });
  assert.deepEqual(receiptMovementLines([bridge]), { movements: [], nativeValueIsMovement: false });
  const nothing = buildReceiptPresentation({ chainId: 1, walletAddress: WALLET, status: 'success', transactionKind: 'action', transfers: [], executionCostWei: 1n });
  assert.deepEqual(receiptMovementLines([nothing]), { movements: [], nativeValueIsMovement: false });
});
