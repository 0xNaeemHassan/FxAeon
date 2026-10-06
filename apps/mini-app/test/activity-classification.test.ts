import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFunctionData, getAddress, maxUint256, parseAbi, type Address, type Hex } from 'viem';
import { compactAddress } from '../src/lib/addressPresentation';
import {
  activityLegs,
  classifyActivity,
  formatActivityAmount,
  netActivityFlows,
  signedLegText,
  type ActivityClassificationInput,
  type ActivityTransferInput,
} from '../src/lib/activityClassification';
import { decodeActivityCall, POSITION_CLOSE_SENTINEL } from '../src/lib/activityCalldata';
import { FX_TOKENS } from '../src/lib/fx/tokens';
import { FX_MINT_ROUTER_ADDRESS, FX_ROUTER_ADDRESS, canonicalBridgeTarget, positionPoolAddress } from '../src/lib/fx/policy';

const WALLET = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const SWAP_ROUTER = `0xf708${'0'.repeat(32)}c0a6` as Address;
const SWAP_PAYER = `0x6a00${'0'.repeat(32)}1068` as Address;
const RECIPIENT = `0x1234${'0'.repeat(32)}abcd` as Address;
const UNKNOWN_CONTRACT = '0x9999999999999999999999999999999999999999' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const HASH = `0x${'a'.repeat(64)}`;
const E18 = 10n ** 18n;
const token = (key: keyof typeof FX_TOKENS) => FX_TOKENS[key].address as Address;

const ABI = parseAbi([
  'function openOrAddPositionFlashLoanV2((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 borrowAmount,bytes data)',
  'function closeOrRemovePositionFlashLoanV2((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 amountOut,uint256 borrowAmount,bytes data)',
  'function openOrAddShortPositionFlashLoan((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 debtTokenBorrowAmount,bytes data)',
  'function closeOrRemoveShortPositionFlashLoan((address tokenOut,address converter,uint256 encodings,uint256[] routes,uint256 minOut,bytes signature) params,address pool,uint256 positionId,uint256 fxUSDWithdrawAmount,uint256 debtTokenBorrowAmount,bytes data)',
  'function borrowFromLong((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) convertInParams,(address pool,uint256 positionId,uint256 borrowAmount) borrowParams)',
  'function repayToLong((address tokenIn,uint256 amount,address target,bytes data,uint256 minOut,bytes signature) convertInParams,(address pool,uint256 positionId,uint256 withdrawAmount) repayParams)',
  'function redeem(uint256 amount,address receiver,address owner)',
  'function requestRedeem(uint256 amount)',
  'function claim(address receiver)',
  'function approve(address spender,uint256 amount)',
  'function transfer(address to,uint256 amount)',
  'function withdraw(uint256 wad)',
  'function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) sendParam,(uint256 nativeFee,uint256 lzTokenFee) fee,address refundAddress)',
]);
const convertIn = { tokenIn: token('wstETH'), amount: E18 / 2n, target: ZERO, data: '0x' as Hex, minOut: 0n, signature: '0x' as Hex };
const convertOut = { tokenOut: ZERO, converter: ZERO, encodings: 0n, routes: [] as bigint[], minOut: 1n, signature: '0x' as Hex };

const openLong = (positionId: bigint, market: 'ETH' | 'BTC' = 'ETH') => encodeFunctionData({ abi: ABI, functionName: 'openOrAddPositionFlashLoanV2',
  args: [convertIn, positionPoolAddress(market, 'long'), positionId, 0n, '0x'] });
const closeLong = (amountOut: bigint, market: 'ETH' | 'BTC' = 'ETH') => encodeFunctionData({ abi: ABI, functionName: 'closeOrRemovePositionFlashLoanV2',
  args: [convertOut, positionPoolAddress(market, 'long'), 7n, amountOut, 0n, '0x'] });

function transfer(overrides: Partial<ActivityTransferInput> & Pick<ActivityTransferInput, 'direction' | 'amountRaw'>): ActivityTransferInput {
  return { token: null, symbol: 'ETH', decimals: 18, counterparty: OTHER, verified: true, ...overrides };
}
const tokenTransfer = (key: keyof typeof FX_TOKENS, direction: 'in' | 'out', amountRaw: bigint, counterparty: Address = OTHER): ActivityTransferInput =>
  transfer({ token: token(key), symbol: key, decimals: FX_TOKENS[key].decimals, direction, amountRaw, counterparty });

function classify(overrides: Partial<ActivityClassificationInput>) {
  return classifyActivity({ chainId: 1, hash: HASH, timestamp: 1_000, wallet: WALLET, status: 'indexed', transfers: [], ...overrides });
}

test('the reported swap reads as one swap with rounded amounts, not four raw transfers', () => {
  const result = classify({
    call: { from: WALLET, to: SWAP_ROUTER, input: '0x12345678' },
    transfers: [
      tokenTransfer('FXN', 'out', 347_283_749_274_123_456n, SWAP_ROUTER),
      tokenTransfer('wstETH', 'out', 1_133_198_765_432_101n, SWAP_ROUTER),
      transfer({ direction: 'in', amountRaw: 14_686_674_975_273_290n, counterparty: SWAP_PAYER }),
      transfer({ direction: 'in', amountRaw: 1_410_448_481_515_722n, counterparty: SWAP_PAYER }),
    ],
  });
  assert.equal(result.kind, 'swap');
  assert.equal(result.title, 'Swapped FXN + wstETH for ETH');
  assert.equal(result.summary, 'You swapped 0.34728 FXN and 0.0011331 wstETH for 0.016097 ETH.');
  assert.deepEqual(result.flowsIn.map((flow) => [flow.symbol, flow.amount, flow.exact]), [['ETH', '0.016097', '0.016097123456789012']]);
  assert.deepEqual(result.flowsOut.map((flow) => [flow.symbol, flow.amount]), [['FXN', '0.34728'], ['wstETH', '0.0011331']]);
  assert.equal(result.counterparty?.address, getAddress(SWAP_ROUTER));
  assert.equal(result.counterparty?.label, compactAddress(getAddress(SWAP_ROUTER)));
  assert.equal(result.counterparty?.known, false);
  assert.deepEqual(result.icons, ['FXN', 'ETH']);
  assert.equal(result.glyph, 'swap');
  assert.equal(result.spamSuspect, false);
  // The row leads with what arrived and lists the other legs with a true minus sign.
  const legs = activityLegs(result);
  assert.equal(legs.primary && signedLegText(legs.primary), '+0.016097 ETH');
  assert.deepEqual(legs.others.map(signedLegText), ['−0.34728 FXN', '−0.0011331 wstETH']);
});

test('a swap without calldata still names the swap from its flow shape', () => {
  const result = classify({ transfers: [tokenTransfer('USDC', 'out', 250_000_000n, SWAP_ROUTER), transfer({ direction: 'in', amountRaw: E18 / 10n, counterparty: SWAP_PAYER })] });
  assert.equal(result.title, 'Swapped USDC for ETH');
  assert.equal(result.counterparty?.address, getAddress(SWAP_ROUTER));
});

test('swap titles cap at two symbols and then count the rest', () => {
  const result = classify({ transfers: [
    tokenTransfer('FXN', 'out', E18), tokenTransfer('wstETH', 'out', E18), tokenTransfer('USDC', 'out', 1_000_000n), tokenTransfer('USDT', 'out', 1_000_000n),
    transfer({ direction: 'in', amountRaw: E18 }),
  ] });
  assert.equal(result.title, 'Swapped FXN + wstETH + 2 more for ETH');
});

test('long and short position calls name the market, side, and open/add/reduce/close', () => {
  const opened = classify({ status: 'confirmed', call: { from: WALLET, to: FX_ROUTER_ADDRESS, input: openLong(0n) }, transfers: [tokenTransfer('wstETH', 'out', E18 / 2n, FX_ROUTER_ADDRESS)] });
  assert.equal(opened.kind, 'open');
  assert.equal(opened.title, 'Opened ETH long');
  assert.equal(opened.summary, 'You opened an ETH long with 0.5 wstETH.');
  assert.equal(opened.counterparty?.label, 'f(x) Router');
  assert.equal(opened.glyph, 'long');
  assert.deepEqual(opened.icons, ['wstETH', 'ETH']);
  assert.deepEqual(opened.position, { market: 'ETH', side: 'long' });

  const added = classify({ call: { from: WALLET, to: FX_ROUTER_ADDRESS, input: openLong(7n, 'BTC') }, transfers: [tokenTransfer('WBTC', 'out', 10_000_000n, FX_ROUTER_ADDRESS)] });
  assert.equal(added.title, 'Added to BTC long');
  assert.equal(added.summary, 'You added 0.1 WBTC to your BTC long.');

  const closed = classify({ call: { from: WALLET, to: FX_ROUTER_ADDRESS, input: closeLong(POSITION_CLOSE_SENTINEL) }, transfers: [transfer({ direction: 'in', amountRaw: 6n * E18 / 10n, counterparty: FX_ROUTER_ADDRESS })] });
  assert.equal(closed.title, 'Closed ETH long');
  assert.equal(closed.summary, 'You closed your ETH long and received 0.6 ETH.');
  assert.deepEqual(closed.icons, ['ETH']);

  const reduced = classify({ call: { from: WALLET, to: FX_ROUTER_ADDRESS, input: closeLong(E18) }, transfers: [transfer({ direction: 'in', amountRaw: E18 / 5n, counterparty: FX_ROUTER_ADDRESS })] });
  assert.equal(reduced.title, 'Reduced ETH long');

  const shortOpen = encodeFunctionData({ abi: ABI, functionName: 'openOrAddShortPositionFlashLoan',
    args: [{ ...convertIn, tokenIn: token('fxUSD') }, positionPoolAddress('BTC', 'short'), 0n, 0n, '0x'] });
  const shortOpened = classify({ call: { from: WALLET, to: FX_ROUTER_ADDRESS, input: shortOpen }, transfers: [tokenTransfer('fxUSD', 'out', 500n * E18, FX_ROUTER_ADDRESS)] });
  assert.equal(shortOpened.title, 'Opened BTC short');
  assert.equal(shortOpened.glyph, 'short');
  assert.equal(shortOpened.summary, 'You opened a BTC short with 500 fxUSD.');

  const shortClose = encodeFunctionData({ abi: ABI, functionName: 'closeOrRemoveShortPositionFlashLoan',
    args: [convertOut, positionPoolAddress('ETH', 'short'), 3n, POSITION_CLOSE_SENTINEL, 0n, '0x'] });
  const shortClosed = classify({ call: { from: WALLET, to: FX_ROUTER_ADDRESS, input: shortClose }, transfers: [tokenTransfer('fxUSD', 'in', 480n * E18, FX_ROUTER_ADDRESS)] });
  assert.equal(shortClosed.title, 'Closed ETH short');
  assert.equal(shortClosed.glyph, 'short');
});

test('a bare selector plus position NFT movements still identifies the position', () => {
  const pool = positionPoolAddress('ETH', 'long');
  const opened = classify({ call: { from: WALLET, to: FX_ROUTER_ADDRESS, selector: '0xef9e1aa7' },
    nfts: [{ pool, tokenId: 12n, direction: 'in', counterparty: FX_ROUTER_ADDRESS }], transfers: [transfer({ direction: 'out', amountRaw: E18, counterparty: FX_ROUTER_ADDRESS })] });
  assert.equal(opened.title, 'Opened ETH long');

  const added = classify({ call: { from: WALLET, to: FX_ROUTER_ADDRESS, selector: '0xef9e1aa7' },
    nfts: [{ pool, tokenId: 12n, direction: 'out', counterparty: FX_ROUTER_ADDRESS }, { pool, tokenId: 12n, direction: 'in', counterparty: FX_ROUTER_ADDRESS }],
    transfers: [transfer({ direction: 'out', amountRaw: E18, counterparty: FX_ROUTER_ADDRESS })] });
  assert.equal(added.title, 'Added to ETH long');

  const shortReduced = classify({ call: { from: WALLET, to: FX_ROUTER_ADDRESS, selector: '0xad0acfdc' },
    nfts: [{ pool: positionPoolAddress('BTC', 'short'), tokenId: 4n, direction: 'out', counterparty: FX_ROUTER_ADDRESS }],
    transfers: [tokenTransfer('fxUSD', 'in', E18, FX_ROUTER_ADDRESS)] });
  assert.equal(shortReduced.title, 'Reduced BTC short');

  // Without any calldata, the NFT alone still marks a new position.
  const fromNftOnly = classify({ nfts: [{ pool, tokenId: 9n, direction: 'in', counterparty: FX_ROUTER_ADDRESS }], transfers: [tokenTransfer('USDC', 'out', 100_000_000n, FX_ROUTER_ADDRESS)] });
  assert.equal(fromNftOnly.title, 'Opened ETH long');
  assert.equal(fromNftOnly.summary, 'You opened an ETH long with 100 USDC.');
});

test('the protocol index outranks calldata, and the journal intent outranks both', () => {
  const closed = classify({ status: 'confirmed', protocol: [{ market: 'ETH', side: 'long', kind: 'close', positionId: 4 }],
    call: { from: WALLET, to: FX_ROUTER_ADDRESS, input: closeLong(E18) }, transfers: [] });
  assert.equal(closed.title, 'Closed ETH long');
  assert.equal(closed.position?.positionId, 4);
  const intent = classify({ status: 'confirmed', journal: { intent: 'Reduce position', operation: 'reducePosition', stepKind: 'action', to: FX_ROUTER_ADDRESS },
    protocol: [{ market: 'BTC', side: 'short', kind: 'close' }], transfers: [] });
  assert.equal(intent.title, 'Reduced BTC short');
  // The index's Open also covers additions; calldata decides which.
  const added = classify({ protocol: [{ market: 'ETH', side: 'long', kind: 'open' }], call: { from: WALLET, to: FX_ROUTER_ADDRESS, input: openLong(5n) }, transfers: [] });
  assert.equal(added.title, 'Added to ETH long');
});

test('fxSAVE deposits, withdrawals, queued withdrawals, and claims', () => {
  const deposit = classify({ call: { from: WALLET, to: FX_ROUTER_ADDRESS, selector: '0x3ea34dc0' },
    transfers: [tokenTransfer('fxUSD', 'out', 100n * E18, FX_ROUTER_ADDRESS), tokenTransfer('fxSAVE', 'in', 953n * E18 / 10n, ZERO)] });
  assert.equal(deposit.title, 'Deposited to fxSAVE');
  assert.equal(deposit.summary, 'You deposited 100 fxUSD into fxSAVE and received 95.3 fxSAVE.');
  assert.equal(deposit.glyph, 'earn');
  assert.deepEqual(deposit.icons, ['fxUSD', 'fxSAVE']);
  assert.equal(activityLegs(deposit).primary?.flow.symbol, 'fxUSD');

  const withdraw = classify({ call: { from: WALLET, to: token('fxSAVE'), input: encodeFunctionData({ abi: ABI, functionName: 'redeem', args: [95n * E18, WALLET, WALLET] }) },
    transfers: [tokenTransfer('fxSAVE', 'out', 95n * E18, ZERO), tokenTransfer('fxUSDBasePool', 'in', 99n * E18, token('fxSAVE'))] });
  assert.equal(withdraw.title, 'Withdrew from fxSAVE');
  assert.equal(withdraw.summary, 'You withdrew 99 fxUSDBasePool from fxSAVE by redeeming 95 fxSAVE.');
  assert.equal(withdraw.counterparty?.label, 'fxSAVE vault');

  const queued = classify({ call: { from: WALLET, to: token('fxSAVE'), input: encodeFunctionData({ abi: ABI, functionName: 'requestRedeem', args: [10n * E18] }) },
    transfers: [tokenTransfer('fxSAVE', 'out', 10n * E18, token('fxSAVE'))] });
  assert.equal(queued.title, 'Queued fxSAVE withdrawal');
  assert.equal(queued.summary, 'You queued 10 fxSAVE for withdrawal.');

  const claimed = classify({ call: { from: WALLET, to: token('fxSAVE'), input: encodeFunctionData({ abi: ABI, functionName: 'claim', args: [WALLET] }) },
    transfers: [tokenTransfer('fxUSD', 'in', 10n * E18, token('fxSAVE'))] });
  assert.equal(claimed.title, 'Claimed fxSAVE withdrawal');
  assert.equal(claimed.summary, 'You claimed 10 fxUSD from your fxSAVE withdrawal.');

  const journalWithdraw = classify({ status: 'confirmed', journal: { intent: 'Withdraw', operation: 'withdrawFxSave', stepKind: 'action', to: FX_ROUTER_ADDRESS }, transfers: [] });
  assert.equal(journalWithdraw.title, 'Withdrew from fxSAVE');
});

test('borrow, add collateral, repay, and withdraw collateral through the mint router', () => {
  const pool = positionPoolAddress('ETH', 'long');
  const borrow = (positionId: bigint, borrowAmount: bigint) => encodeFunctionData({ abi: ABI, functionName: 'borrowFromLong', args: [convertIn, { pool, positionId, borrowAmount }] });
  const borrowed = classify({ call: { from: WALLET, to: FX_MINT_ROUTER_ADDRESS, input: borrow(0n, 1_000n * E18) },
    transfers: [tokenTransfer('wstETH', 'out', E18 / 2n, FX_MINT_ROUTER_ADDRESS), tokenTransfer('fxUSD', 'in', 1_000n * E18, ZERO)] });
  assert.equal(borrowed.title, 'Borrowed fxUSD');
  assert.equal(borrowed.summary, 'You borrowed 1,000 fxUSD against 0.5 wstETH.');
  assert.equal(borrowed.counterparty?.label, 'f(x) Mint Router');
  assert.equal(borrowed.glyph, 'borrow');
  assert.equal(activityLegs(borrowed).primary?.flow.symbol, 'fxUSD');

  const collateral = classify({ call: { from: WALLET, to: FX_MINT_ROUTER_ADDRESS, input: borrow(7n, 0n) }, transfers: [tokenTransfer('wstETH', 'out', E18, FX_MINT_ROUTER_ADDRESS)] });
  assert.equal(collateral.title, 'Added collateral');
  assert.equal(collateral.summary, 'You added 1 wstETH as collateral.');

  const repay = (amount: bigint, withdrawAmount: bigint) => encodeFunctionData({ abi: ABI, functionName: 'repayToLong',
    args: [{ ...convertIn, tokenIn: token('fxUSD'), amount }, { pool, positionId: 7n, withdrawAmount }] });
  const repaid = classify({ call: { from: WALLET, to: FX_MINT_ROUTER_ADDRESS, input: repay(500n * E18, E18 / 10n) },
    transfers: [tokenTransfer('fxUSD', 'out', 500n * E18, FX_MINT_ROUTER_ADDRESS), tokenTransfer('wstETH', 'in', E18 / 10n, FX_MINT_ROUTER_ADDRESS)] });
  assert.equal(repaid.title, 'Repaid fxUSD');
  assert.equal(repaid.summary, 'You repaid 500 fxUSD and withdrew 0.1 wstETH.');
  assert.equal(activityLegs(repaid).primary?.flow.symbol, 'fxUSD');

  const withdrawn = classify({ call: { from: WALLET, to: FX_MINT_ROUTER_ADDRESS, input: repay(0n, E18) }, transfers: [tokenTransfer('wstETH', 'in', E18, FX_MINT_ROUTER_ADDRESS)] });
  assert.equal(withdrawn.title, 'Withdrew collateral');
  assert.equal(withdrawn.summary, 'You withdrew 1 wstETH of collateral.');

  const journalRepay = classify({ status: 'confirmed', journal: { intent: 'Repay and withdraw', operation: 'repayAndWithdraw', stepKind: 'action', to: FX_MINT_ROUTER_ADDRESS },
    transfers: [tokenTransfer('fxUSD', 'out', 20n * E18, FX_MINT_ROUTER_ADDRESS)] });
  assert.equal(journalRepay.title, 'Repaid fxUSD');
});

test('bridges read as moves out and arrivals in, with the LayerZero fee kept apart', () => {
  const adapter = canonicalBridgeTarget('fxUSD', 1);
  const out = classify({ status: 'confirmed', journal: { intent: 'Bridge', operation: 'buildBridgeTx', stepKind: 'action', to: adapter, bridge: { destinationChainId: 8453, bridgeToken: 'fxUSD' } },
    transfers: [transfer({ direction: 'out', amountRaw: 120_000_000_000_000n, counterparty: adapter }), tokenTransfer('fxUSD', 'out', 100n * E18, adapter)] });
  assert.equal(out.kind, 'bridgeOut');
  assert.equal(out.title, 'Moved fxUSD to Base');
  assert.equal(out.summary, 'You moved 100 fxUSD from Ethereum to Base and paid 0.00012 ETH in bridge fees.');
  assert.equal(out.counterparty?.label, 'LayerZero bridge');
  assert.equal(out.glyph, 'move');
  assert.deepEqual(out.bridge, { from: 1, to: 8453 });
  const legs = activityLegs(out);
  assert.equal(legs.primary && signedLegText(legs.primary), '−100 fxUSD');
  assert.deepEqual(legs.others.map(signedLegText), ['−0.00012 ETH']);

  // From Base, the OFT is the token itself and the calldata names the destination.
  const baseToken = canonicalBridgeTarget('fxSAVE', 8453);
  const input = encodeFunctionData({ abi: ABI, functionName: 'send', args: [{ dstEid: 30101, to: `0x${'0'.repeat(24)}${WALLET.slice(2)}`, amountLD: 5n * E18, minAmountLD: 5n * E18, extraOptions: '0x', composeMsg: '0x', oftCmd: '0x' }, { nativeFee: 1n, lzTokenFee: 0n }, WALLET] });
  const fromBase = classifyActivity({ chainId: 8453, hash: HASH, timestamp: 1, wallet: WALLET, status: 'indexed', call: { from: WALLET, to: baseToken, input },
    transfers: [{ token: baseToken, symbol: 'fxSAVE', decimals: 18, amountRaw: 5n * E18, direction: 'out', counterparty: ZERO, verified: true }] });
  assert.equal(fromBase.title, 'Moved fxSAVE to Ethereum');
  assert.equal(fromBase.counterparty?.label, 'LayerZero bridge');

  const arrivedOnBase = classifyActivity({ chainId: 8453, hash: HASH, timestamp: 1, wallet: WALLET, status: 'indexed', call: { from: OTHER, to: '0x1a44076050125825900e736c501f859c50fE728c', input: '0x13137d65' },
    transfers: [{ token: canonicalBridgeTarget('fxUSD', 8453), symbol: 'fxUSD', decimals: 18, amountRaw: 100n * E18, direction: 'in', counterparty: ZERO, verified: true }] });
  assert.equal(arrivedOnBase.kind, 'bridgeIn');
  assert.equal(arrivedOnBase.title, 'Received fxUSD on Base');
  assert.equal(arrivedOnBase.summary, 'You received 100 fxUSD on Base from Ethereum.');
  assert.equal(arrivedOnBase.counterparty?.label, 'LayerZero bridge');

  const arrivedOnEthereum = classify({ transfers: [tokenTransfer('fxUSD', 'in', 40n * E18, adapter)] });
  assert.equal(arrivedOnEthereum.title, 'Received fxUSD on Ethereum');
  assert.deepEqual(arrivedOnEthereum.bridge, { from: 8453, to: 1 });
});

test('approvals show the token, the spender, and whether the allowance is exact or unlimited', () => {
  const approve = (amount: bigint) => encodeFunctionData({ abi: ABI, functionName: 'approve', args: [FX_ROUTER_ADDRESS, amount] });
  const exact = classify({ call: { from: WALLET, to: token('wstETH'), input: approve(E18 / 2n) } });
  assert.equal(exact.kind, 'approve');
  assert.equal(exact.title, 'Approved wstETH');
  assert.equal(exact.summary, 'You allowed the f(x) Router to spend up to 0.5 wstETH.');
  assert.deepEqual(exact.approval, { token: 'wstETH', verified: true, unlimited: false, revoke: false, amount: '0.5', exact: '0.5' });
  assert.equal(exact.counterparty?.label, 'f(x) Router');
  assert.equal(exact.glyph, 'approve');
  assert.deepEqual(exact.icons, ['wstETH']);

  const unlimited = classify({ call: { from: WALLET, to: token('USDC'), input: approve(maxUint256) } });
  assert.equal(unlimited.approval?.unlimited, true);
  assert.equal(unlimited.approval?.amount, null);
  assert.equal(unlimited.summary, 'You allowed the f(x) Router to spend unlimited USDC.');

  const revoked = classify({ call: { from: WALLET, to: token('USDC'), input: approve(0n) } });
  assert.equal(revoked.title, 'Revoked USDC approval');

  // A journal approval keeps its step identity even without calldata.
  const journal = classify({ status: 'confirmed', journal: { stepKind: 'approval', intent: 'Open position', operation: 'increasePosition', to: token('fxUSD') }, transfers: [] });
  assert.equal(journal.title, 'Approved fxUSD');
  assert.equal(journal.summary, 'You allowed a contract to spend your fxUSD.');
  const pending = classify({ status: 'pending', journal: { stepKind: 'approval', operation: 'increasePosition', to: token('fxUSD') }, transfers: [] });
  assert.equal(pending.title, 'Approve fxUSD');

  const unknownToken = classify({ call: { from: WALLET, to: UNKNOWN_CONTRACT, input: approve(E18) } });
  assert.equal(unknownToken.title, 'Approved token');
  assert.deepEqual(unknownToken.icons, ['?']);

  const position = classify({ status: 'confirmed', journal: { stepKind: 'approval', operation: 'reducePosition', to: positionPoolAddress('ETH', 'short') },
    call: { from: WALLET, to: positionPoolAddress('ETH', 'short'), input: approve(12n) }, transfers: [] });
  assert.equal(position.title, 'Approved ETH short position');
  assert.equal(position.summary, 'You allowed the f(x) Router to manage your ETH short position.');
  assert.equal(position.approval, undefined);
});

test('wrapping and unwrapping WETH', () => {
  const weth = token('WETH');
  const wrapped = classify({ call: { from: WALLET, to: weth, input: '0xd0e30db0', value: E18 }, transfers: [transfer({ direction: 'out', amountRaw: E18, counterparty: weth })] });
  assert.equal(wrapped.kind, 'wrap');
  assert.equal(wrapped.title, 'Wrapped ETH');
  assert.equal(wrapped.summary, 'You wrapped 1 ETH into WETH.');
  assert.equal(wrapped.counterparty?.label, 'WETH');
  assert.deepEqual(wrapped.icons, ['ETH', 'WETH']);

  const unwrapped = classify({ call: { from: WALLET, to: weth, input: encodeFunctionData({ abi: ABI, functionName: 'withdraw', args: [E18 / 2n] }) }, transfers: [] });
  assert.equal(unwrapped.title, 'Unwrapped WETH');
  assert.equal(unwrapped.summary, 'You unwrapped 0.5 WETH into ETH.');
});

test('plain sends and receives name the asset and the other address', () => {
  const sent = classify({ call: { from: WALLET, to: RECIPIENT, input: '0x', value: 23_250_000_000_000_000n },
    transfers: [transfer({ direction: 'out', amountRaw: 23_250_000_000_000_000n, counterparty: RECIPIENT })] });
  assert.equal(sent.kind, 'send');
  assert.equal(sent.title, 'Sent ETH');
  assert.equal(sent.summary, `You sent 0.02325 ETH to ${compactAddress(getAddress(RECIPIENT))}.`);
  assert.equal(sent.glyph, 'send');

  const tokenSend = classify({ call: { from: WALLET, to: token('USDC'), input: encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [RECIPIENT, 5_000_000n] }) },
    transfers: [tokenTransfer('USDC', 'out', 5_000_000n, RECIPIENT)] });
  assert.equal(tokenSend.title, 'Sent USDC');
  assert.equal(tokenSend.counterparty?.address, getAddress(RECIPIENT));

  const received = classify({ transfers: [transfer({ direction: 'in', amountRaw: 123n * E18 / 1000n })] });
  assert.equal(received.kind, 'receive');
  assert.equal(received.title, 'Received ETH');
  assert.equal(received.summary, 'You received 0.123 ETH from 0x2222…2222.');
  assert.equal(received.glyph, 'receive');

  // A pending journal send names its asset before any transfer is indexed.
  const pending = classify({ status: 'pending', journal: { intent: 'Send', operation: 'sendAsset', stepKind: 'action', to: token('USDT') }, transfers: [] });
  assert.equal(pending.title, 'Send USDT');
  assert.equal(pending.summary, 'Waiting for confirmation on Ethereum.');
});

test('an unknown contract call that moved nothing is a contract interaction', () => {
  const result = classify({ status: 'confirmed', call: { from: WALLET, to: UNKNOWN_CONTRACT, input: '0xdeadbeef' } });
  assert.equal(result.kind, 'contract');
  assert.equal(result.title, 'Contract interaction');
  assert.equal(result.summary, 'You interacted with 0x9999…9999. No tokens moved.');
  assert.equal(result.glyph, 'contract');
  assert.deepEqual(result.icons, []);
  assert.deepEqual(activityLegs(result), { others: [] });

  // Paying into an unknown function is a contract interaction, not a send to a person.
  const paid = classify({ call: { from: WALLET, to: UNKNOWN_CONTRACT, input: '0xdeadbeef', value: E18 / 20n },
    transfers: [transfer({ direction: 'out', amountRaw: E18 / 20n, counterparty: UNKNOWN_CONTRACT })] });
  assert.equal(paid.kind, 'contract');
  assert.equal(paid.summary, 'You sent 0.05 ETH in a contract interaction with 0x9999…9999.');
  assert.equal(activityLegs(paid).primary && signedLegText(activityLegs(paid).primary!), '−0.05 ETH');
  // Without calldata, a single recipient still reads as a send.
  assert.equal(classify({ transfers: [transfer({ direction: 'out', amountRaw: E18 / 20n, counterparty: UNKNOWN_CONTRACT })] }).kind, 'send');
});

test('a zap-out repayment decodes its unnamed tuples', () => {
  const zap = parseAbi(['function repayToLongAndZapOut((address,uint256,address,bytes,uint256,bytes),(address,uint256,uint256),(address,address,uint256,uint256[],uint256,bytes))']);
  const input = encodeFunctionData({ abi: zap, functionName: 'repayToLongAndZapOut', args: [
    [token('fxUSD'), 3n * E18, ZERO, '0x', 3n * E18, '0x'], [positionPoolAddress('BTC', 'long'), 2n, E18], [ZERO, ZERO, 0n, [], 1n, '0x'],
  ] });
  const decoded = decodeActivityCall(input);
  assert.equal(decoded?.kind, 'repay');
  assert.equal(decoded?.kind === 'repay' && decoded.repayAmount, 3n * E18);
  assert.equal(decoded?.kind === 'repay' && decoded.zapOut, true);
  const result = classify({ call: { from: WALLET, to: FX_MINT_ROUTER_ADDRESS, input }, transfers: [tokenTransfer('fxUSD', 'out', 3n * E18, FX_MINT_ROUTER_ADDRESS), tokenTransfer('USDC', 'in', 50_000_000n, FX_MINT_ROUTER_ADDRESS)] });
  assert.equal(result.title, 'Repaid fxUSD');
  assert.equal(result.summary, 'You repaid 3 fxUSD and withdrew 50 USDC.');
});

test('unverified-only incoming tokens are spam-suspect and never shown without a marker', () => {
  const spam: ActivityTransferInput = { token: '0x3333333333333333333333333333333333333333', symbol: 'CLAIM', decimals: 18, amountRaw: 1_000n * E18, direction: 'in', counterparty: OTHER, verified: false };
  const result = classify({ call: { from: OTHER, to: spam.token, input: '0x12345678' }, transfers: [spam] });
  assert.equal(result.spamSuspect, true);
  assert.equal(result.kind, 'receive');
  assert.equal(result.title, 'Received unverified token');
  assert.equal(result.summary, 'You received 1,000 CLAIM (unverified) from 0x2222…2222.');
  assert.deepEqual(result.icons, ['?']);
  assert.equal(result.flowsIn[0].verified, false);

  assert.equal(classify({ transfers: [spam] }).spamSuspect, true, 'unknown sender still hides an unverified-only receipt');
  assert.equal(classify({ transfers: [spam, { ...spam, token: '0x4444444444444444444444444444444444444444', symbol: 'GIFT' }] }).title, 'Received 2 unverified tokens');
  // Spoofed "outgoing" transfers of fake tokens are suspect too unless the wallet sent the transaction.
  assert.equal(classify({ transfers: [{ ...spam, direction: 'out' }] }).spamSuspect, true);
  assert.equal(classify({ call: { from: WALLET, to: OTHER, input: '0x12345678' }, transfers: [spam] }).spamSuspect, false);
  assert.equal(classify({ transfers: [spam, transfer({ direction: 'in', amountRaw: E18 })] }).spamSuspect, false);
  // Unknown decimals keep the symbol marked and the amount out of the sentence.
  const undecimaled = classify({ transfers: [{ ...spam, decimals: null }] });
  assert.equal(undecimaled.flowsIn[0].amount, null);
  assert.equal(undecimaled.summary, 'You received CLAIM (unverified) from 0x2222…2222.');
});

test('a failed journal record states the attempt and that nothing moved', () => {
  const result = classify({ status: 'failed', journal: { intent: 'Open position', operation: 'increasePosition', stepKind: 'action', to: FX_ROUTER_ADDRESS },
    transfers: [tokenTransfer('wstETH', 'out', E18, FX_ROUTER_ADDRESS)] });
  assert.equal(result.kind, 'failed');
  assert.equal(result.attempted, 'open');
  assert.equal(result.title, 'Open position');
  assert.equal(result.summary, 'This transaction failed on Ethereum. Nothing moved except the network fee.');
  assert.deepEqual(result.flowsIn, []);
  assert.deepEqual(result.flowsOut, []);
  assert.equal(result.glyph, 'long');
  assert.equal(result.counterparty?.label, 'f(x) Router');
});

test('journal operations without an intent keep their legacy action names while pending', () => {
  const open = classify({ status: 'pending', journal: { operation: 'increasePosition', stepKind: 'action', to: OTHER }, transfers: [] });
  assert.equal(open.title, 'Open position');
  const deposit = classify({ status: 'pending', journal: { operation: 'depositFxSave', stepKind: 'action', to: OTHER }, transfers: [] });
  assert.equal(deposit.title, 'Deposit to fxSAVE');
  const confirmed = classify({ status: 'confirmed', journal: { operation: 'depositFxSave', stepKind: 'action', to: OTHER }, transfers: [] });
  assert.equal(confirmed.title, 'Deposited to fxSAVE');
});

test('the same token in and out nets out; only the difference is shown', () => {
  const refund = netActivityFlows([
    transfer({ direction: 'out', amountRaw: E18 }),
    transfer({ direction: 'in', amountRaw: E18 / 4n }),
    tokenTransfer('USDC', 'in', 2_000_000_000n),
  ]);
  assert.deepEqual(refund.flowsOut.map((flow) => [flow.symbol, flow.amount]), [['ETH', '0.75']]);
  assert.deepEqual(refund.flowsIn.map((flow) => [flow.symbol, flow.amount]), [['USDC', '2,000']]);

  const roundTrip = classify({ call: { from: WALLET, to: UNKNOWN_CONTRACT, input: '0x12345678' },
    transfers: [tokenTransfer('fxUSD', 'out', 5n * E18, UNKNOWN_CONTRACT), tokenTransfer('fxUSD', 'in', 5n * E18, UNKNOWN_CONTRACT)] });
  assert.deepEqual(roundTrip.flowsIn, []);
  assert.deepEqual(roundTrip.flowsOut, []);
  assert.equal(roundTrip.title, 'Contract interaction');
  assert.equal(roundTrip.summary, 'You interacted with 0x9999…9999. No tokens moved.');
});

test('amounts keep five significant digits, truncate toward zero, and bound dust', () => {
  assert.equal(formatActivityAmount(1n, 18), '<0.000001');
  assert.equal(formatActivityAmount(999n, 18), '<0.000001');
  assert.equal(formatActivityAmount(1_000_000_000_000n, 18), '0.000001');
  assert.equal(formatActivityAmount(14_686_674_975_273_290n, 18), '0.014686');
  assert.equal(formatActivityAmount(107_049_999_999_999n, 18), '0.00010704');
  assert.equal(formatActivityAmount(1_234_567_891_000n, 6), '1,234,567.89');
  assert.equal(formatActivityAmount(5n, 0), '5');
  assert.equal(formatActivityAmount(5n, null), null);
  const dust = classify({ transfers: [transfer({ direction: 'in', amountRaw: 1n })] });
  assert.equal(dust.flowsIn[0].amount, '<0.000001');
  assert.equal(dust.flowsIn[0].exact, '0.000000000000000001');
  assert.equal(dust.summary, 'You received <0.000001 ETH from 0x2222…2222.');
});

test('calldata decoding rejects malformed and unknown input', () => {
  assert.equal(decodeActivityCall('0x'), null);
  assert.equal(decodeActivityCall('0xdeadbeef'), null);
  assert.equal(decodeActivityCall('0xef9e1aa7'), null, 'a known selector with truncated arguments is not decoded');
  assert.equal(decodeActivityCall('not hex'), null);
  assert.deepEqual(decodeActivityCall('0xd0e30db0'), { kind: 'wrap' });
  const decoded = decodeActivityCall(closeLong(POSITION_CLOSE_SENTINEL, 'BTC'));
  assert.ok(decoded?.kind === 'position');
  assert.deepEqual({ ...decoded, pool: decoded.pool.toLowerCase() },
    { kind: 'position', side: 'long', direction: 'close', pool: positionPoolAddress('BTC', 'long').toLowerCase(), positionId: 7n, fullClose: true });
  assert.equal(decodeActivityCall(closeLong(E18))?.kind === 'position' && (decodeActivityCall(closeLong(E18)) as { fullClose: boolean }).fullClose, false);
});

test('a transaction someone else sent is never named from its calldata', () => {
  // Someone else's ERC-20 transfer to this wallet is a receive, not "Sent".
  const result = classify({ call: { from: OTHER, to: token('USDC'), input: encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [WALLET, 7_000_000n] }) },
    transfers: [tokenTransfer('USDC', 'in', 7_000_000n, OTHER)] });
  assert.equal(result.title, 'Received USDC');
  assert.equal(result.counterparty?.address, OTHER);
});
