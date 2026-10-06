import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { activityCallRequests, mergeWalletActivity } from '../src/lib/walletActivity';
import type { RecoveryViewModel } from '../src/lib/fx/recovery';
import type { ProtocolPositionActivity } from '../src/lib/protocolPositionHistory';
import type { WalletPositionTransfer, WalletTransfer } from '../src/lib/walletTransferHistory';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { FX_ROUTER_ADDRESS, positionPoolAddress } from '../src/lib/fx/policy';
const wallet = '0x1111111111111111111111111111111111111111' as Address;
const hash = `0x${'a'.repeat(64)}` as Hex;
const transfer: WalletTransfer = { id: 'transfer', hash, chainId: 1, timestamp: 1_000, from: wallet, to: '0x2222222222222222222222222222222222222222', amountRaw: 123n, decimals: 18, symbol: 'ETH', tokenAddress: null, verified: true };
const view = (stepKind = 'action', bridge = false): RecoveryViewModel => ({ record: { id: 'record', hash, chainId: 1, submittedAt: 999, stepKind, to: transfer.to, operation: 'increasePosition', ...(bridge ? { bridge: { bridgeToken: 'fxUSD' } } : {}) }, status: 'confirmed', verification: 'receipt' }) as RecoveryViewModel;
const position: ProtocolPositionActivity = { hash, chainId: 1, timestamp: 1, blockNumber: 123n, kind: 'close', market: 'ETH', side: 'long', positionId: 4, poolAddress: transfer.to };
test('journal, indexed transfer and position event produce one row per chain/hash', () => {
  const rows = mergeWalletActivity([view()], [position], [transfer, transfer], wallet);
  assert.equal(rows.length, 1); assert.equal(rows[0].title, 'Closed ETH long'); assert.equal(rows[0].transfers.length, 1);
});
// Intended change: an approval is a step of the action after it, so History leaves it out
// (it used to be listed as "Approved token"). It still never becomes a position or a transfer.
test('an approval is left out of History and never becomes a completed position or a transfer', () => {
  assert.deepEqual(mergeWalletActivity([view('approval')], [position], [transfer], wallet), []);
  const failed = mergeWalletActivity([{ ...view('approval'), status: 'failed' } as RecoveryViewModel], [position], [transfer], wallet);
  assert.equal(failed.length, 1, 'a failed approval explains why its action never happened');
  assert.equal(failed[0].title, 'Approve token'); assert.equal(failed[0].status, 'failed'); assert.equal(failed[0].positions.length, 0); assert.equal(failed[0].transfers.length, 0);
});

test('legacy journal approvals leave History once their step is known', () => {
  // Records from before step kinds were recorded, like the Telegram report's dust wallet.
  const legacy = (id: string, operation: string, intent: string, to: Address, status: RecoveryViewModel['status'] = 'confirmed') => ({
    record: { id, hash: `0x${id.repeat(64)}`, chainId: 1, submittedAt: 999, to, operation, intent, walletAddress: wallet },
    status, verification: 'receipt',
  }) as unknown as RecoveryViewModel;
  const views = [
    legacy('1', 'increasePosition', 'Open position', FX_TOKENS.fxUSD.address),
    legacy('2', 'increasePosition', 'Open position', FX_ROUTER_ADDRESS),
    legacy('3', 'depositAndMint', 'Add collateral', positionPoolAddress('ETH', 'long')),
    legacy('4', 'withdrawFxSave', 'Withdraw', FX_TOKENS.fxSAVE.address),
    legacy('5', 'withdrawFxSave', 'Withdraw', FX_TOKENS.fxSAVE.address),
  ];
  // Mined steps without calldata are read once, so an ambiguous destination can be named.
  assert.deepEqual(activityCallRequests(views, [], []).map((request) => request.hash[2]), ['1', '2', '3', '4', '5']);
  assert.deepEqual(activityCallRequests([legacy('6', 'increasePosition', 'Open position', FX_ROUTER_ADDRESS, 'pending')], [], []), []);
  const approveCall = {
    from: wallet, to: FX_TOKENS.fxSAVE.address as Address, value: 0n,
    input: encodeFunctionData({ abi: parseAbi(['function approve(address spender,uint256 amount)']), functionName: 'approve', args: [FX_ROUTER_ADDRESS, 10n] }),
  };
  const rows = mergeWalletActivity(views, [], [], wallet, { calls: { [`1:0x${'4'.repeat(64)}`]: approveCall } });
  assert.deepEqual(rows.map((row) => row.title).sort(), ['Opened position', 'Withdrew from fxSAVE']);
});
test('source bridge confirmation never means destination delivery', () => {
  assert.equal(mergeWalletActivity([view('action', true)], [], [transfer], wallet)[0].statusLabel, 'Source confirmed');
});
// Intended change: index-only rows name their asset ("Sent ETH"), not just a direction ("Sent").
test('index-only transfers have direction without claiming receipt verification', () => {
  const [sent] = mergeWalletActivity([], [], [transfer], wallet);
  assert.equal(sent.title, 'Sent ETH'); assert.equal(sent.status, 'indexed'); assert.equal(sent.statusLabel, '');
  assert.equal(mergeWalletActivity([], [], [transfer], transfer.to)[0].title, 'Received ETH');
});
test('pending and failed local evidence is not overwritten by an indexed transfer', () => {
  const pending = { ...view(), status: 'pending', verification: 'rpc-error' } as RecoveryViewModel;
  assert.equal(mergeWalletActivity([pending], [], [transfer], wallet)[0].status, 'pending');
  const failed = { ...view(), status: 'failed' } as RecoveryViewModel;
  assert.equal(mergeWalletActivity([failed], [], [transfer], wallet)[0].transfers.length, 0);
  // A cached protocol event cannot override a later pending/reverted receipt.
  assert.equal(mergeWalletActivity([pending], [position], [], wallet)[0].status, 'pending');
  assert.equal(mergeWalletActivity([failed], [position], [], wallet)[0].status, 'failed');
});

const swapHash = `0x${'b'.repeat(64)}` as Hex;
const router = `0xf708${'0'.repeat(32)}c0a6` as Address;
const payer = `0x6a00${'0'.repeat(32)}1068` as Address;
const leg = (overrides: Partial<WalletTransfer> & Pick<WalletTransfer, 'id'>): WalletTransfer => ({ hash: swapHash, chainId: 1, timestamp: 5_000, from: wallet, to: router, amountRaw: 1n, decimals: 18, symbol: 'ETH', tokenAddress: null, verified: true, ...overrides });

test('a swap whose first transfer is incoming is still one swap, not "Received"', () => {
  // The old merge let whichever transfer sorted first fix the title.
  const rows = mergeWalletActivity([], [], [
    leg({ id: 'eth-in', from: payer, to: wallet, amountRaw: 16_097_123_456_789_012n }),
    leg({ id: 'fxn-out', tokenAddress: FX_TOKENS.FXN.address, symbol: 'FXN', amountRaw: 347_283_749_274_123_456n }),
    leg({ id: 'wsteth-out', tokenAddress: FX_TOKENS.wstETH.address, symbol: 'wstETH', amountRaw: 1_133_198_765_432_101n }),
  ], wallet);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Swapped FXN + wstETH for ETH');
  assert.equal(rows[0].classification.summary, 'You swapped 0.34728 FXN and 0.0011331 wstETH for 0.016097 ETH.');
  assert.equal(rows[0].status, 'indexed');
});

test('indexed calldata and position NFTs explain rows; NFTs alone never create one', () => {
  const pool = positionPoolAddress('ETH', 'long');
  const nft = (id: string, txHash: Hex): WalletPositionTransfer => ({ id, chainId: 1, hash: txHash, timestamp: 5_000, from: FX_ROUTER_ADDRESS, to: wallet, pool, tokenId: 9n });
  const rows = mergeWalletActivity([], [], [leg({ id: 'collateral', tokenAddress: FX_TOKENS.wstETH.address, symbol: 'wstETH', to: FX_ROUTER_ADDRESS, amountRaw: 10n ** 18n })], wallet, {
    positionTransfers: [nft('minted', swapHash), nft('orphan', `0x${'c'.repeat(64)}` as Hex)],
    calls: { [`1:${swapHash}`]: { from: wallet, to: FX_ROUTER_ADDRESS, input: '0xef9e1aa7', value: 0n } },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Opened ETH long');
  assert.equal(rows[0].positionTransfers.length, 1);
  assert.equal(rows[0].classification.counterparty?.label, 'f(x) Router');
});

test('a confirmed journal record without indexed transfers falls back to its receipt facts', () => {
  const confirmed = { ...view(), record: { ...view().record, intent: 'Deposit', operation: 'depositFxSave', to: FX_ROUTER_ADDRESS },
    receiptTransfers: [
      { token: FX_TOKENS.fxUSD.address, from: wallet, to: FX_ROUTER_ADDRESS, amountRaw: 100n * 10n ** 18n },
      { token: FX_TOKENS.fxSAVE.address, from: '0x0000000000000000000000000000000000000000', to: wallet, amountRaw: 95n * 10n ** 18n },
    ] } as RecoveryViewModel;
  const [row] = mergeWalletActivity([confirmed], [], [], wallet);
  assert.equal(row.title, 'Deposited to fxSAVE');
  assert.equal(row.classification.summary, 'You deposited 100 fxUSD into fxSAVE and received 95 fxSAVE.');
});

test('rows without a journal record ask for calldata, journal rows with a step kind do not', () => {
  const other = leg({ id: 'other', hash: `0x${'d'.repeat(64)}` as Hex });
  assert.deepEqual(activityCallRequests([view()], [position], [transfer, other]), [{ chainId: 1, hash: `0x${'d'.repeat(64)}` }]);
});

test('unverified-only incoming rows are flagged as spam-suspect', () => {
  const [row] = mergeWalletActivity([], [], [leg({ id: 'spam', from: payer, to: wallet, tokenAddress: '0x3333333333333333333333333333333333333333', symbol: 'CLAIM', verified: false, amountRaw: 10n ** 18n })], wallet);
  assert.equal(row.spamSuspect, true);
  assert.equal(row.title, 'Received unverified token');
});
