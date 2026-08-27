import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, Hex } from 'viem';
import {
  assertBridgeActionTarget,
  assertChecksummedAddress,
  bridgeDeliveryLowerBound,
  planBridge,
  resolveBridgeApprovalTokenAddress,
  resolveBridgeTokenAddress,
  validateAdvancedBridgeContracts,
} from '../src/lib/fx/bridge';
import { advancedBridgePolicy } from '../src/lib/fx/policy';
import { OFT_SEND_SELECTOR } from '../src/lib/fx/validation';
import type { PlannedRoute } from '../src/lib/fx/types';

const SOURCE = '0x52908400098527886E0F7030069857D2E4169EE7' as Address;
const DESTINATION = '0x8617E340B3D01FA5F11F306F4090FD50E238070D' as Address;
const APPROVAL = '0xde709f2102306220921060314715629080e2fb77' as Address;
const WALLET = '0x1111111111111111111111111111111111111111' as Address;

function bytes32(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

function client(params: { bytecode?: Hex; decimals?: bigint; chainId?: number; liveChainId?: number; token?: Address; approvalRequired?: boolean; peer?: string } = {}) {
  const chainId = params.chainId ?? 1;
  const defaultPeer = chainId === 1 ? bytes32(DESTINATION) : bytes32(SOURCE);
  return {
    chain: { id: chainId },
    getChainId: async () => params.liveChainId ?? chainId,
    getBytecode: async () => params.bytecode ?? '0x60006000',
    readContract: async ({ functionName }: { functionName: string }) => functionName === 'token'
      ? params.token ?? SOURCE
      : functionName === 'approvalRequired'
        ? params.approvalRequired ?? false
        : functionName === 'peers'
          ? params.peer ?? defaultPeer
        : params.decimals ?? 18n,
  } as never;
}

test('advanced addresses require EIP-55 checksum casing', () => {
  assert.equal(assertChecksummedAddress(SOURCE, 'source OFT'), SOURCE);
  assert.throws(() => assertChecksummedAddress(SOURCE.toLowerCase(), 'source OFT'), /checksum/);
});

test('advanced bridge contracts require deployed 18-decimal source/destination and Ethereum approval token', async () => {
  const metadata = await validateAdvancedBridgeContracts({
    sourceClient: client({ token: APPROVAL, approvalRequired: true }),
    destinationClient: client({ chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    ethereumApprovalTokenAddress: APPROVAL,
    sourceChainId: 1,
    destinationChainId: 8453,
  });
  assert.equal(metadata.sourceTokenAddress, APPROVAL);
  assert.equal(metadata.destinationTokenAddress, DESTINATION);
  assert.equal(metadata.sourceApprovalRequired, true);
  assert.equal(metadata.destinationApprovalRequired, false);
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ bytecode: '0x', token: APPROVAL, approvalRequired: true }),
    destinationClient: client({ chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    ethereumApprovalTokenAddress: APPROVAL,
    sourceChainId: 1,
    destinationChainId: 8453,
  }), /bytecode/);
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ token: APPROVAL, approvalRequired: true }),
    destinationClient: client({ decimals: 6n, chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    ethereumApprovalTokenAddress: APPROVAL,
    sourceChainId: 1,
    destinationChainId: 8453,
  }), /18 decimals/);
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ token: APPROVAL, approvalRequired: true }),
    destinationClient: client({ chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    sourceChainId: 1,
    destinationChainId: 8453,
  }), /approval token/);
});

test('advanced bridge rejects a client whose live RPC chain differs from the selected chain', async () => {
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ liveChainId: 8453, token: APPROVAL, approvalRequired: true }),
    destinationClient: client({ chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    ethereumApprovalTokenAddress: APPROVAL,
    sourceChainId: 1,
    destinationChainId: 8453,
  }), /RPC endpoint returned chain 8453; expected 1/);
});

test('advanced direct OFTs require no approval and reject an unnecessary approval input', async () => {
  await assert.doesNotReject(() => validateAdvancedBridgeContracts({
    sourceClient: client({ token: SOURCE, approvalRequired: false }),
    destinationClient: client({ chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    sourceChainId: 1,
    destinationChainId: 8453,
  }));
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ token: SOURCE, approvalRequired: false }),
    destinationClient: client({ chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    ethereumApprovalTokenAddress: APPROVAL,
    sourceChainId: 1,
    destinationChainId: 8453,
  }), /does not require approval/);
});

test('advanced adapter approval must bind exactly to token() and Base adapters fail closed', async () => {
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ token: DESTINATION, approvalRequired: true }),
    destinationClient: client({ chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    ethereumApprovalTokenAddress: APPROVAL,
    sourceChainId: 1,
    destinationChainId: 8453,
  }), /exactly match/);
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ chainId: 8453, token: APPROVAL, approvalRequired: true }),
    destinationClient: client({ token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    sourceChainId: 8453,
    destinationChainId: 1,
  }), /Base-source/);
});

test('advanced OFTs require symmetric non-zero LayerZero peers', async () => {
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ token: APPROVAL, approvalRequired: true, peer: bytes32(SOURCE) }),
    destinationClient: client({ chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    ethereumApprovalTokenAddress: APPROVAL,
    sourceChainId: 1,
    destinationChainId: 8453,
  }), /peer does not match/);
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ token: APPROVAL, approvalRequired: true }),
    destinationClient: client({ chainId: 8453, token: DESTINATION, peer: `0x${'00'.repeat(32)}` }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    ethereumApprovalTokenAddress: APPROVAL,
    sourceChainId: 1,
    destinationChainId: 8453,
  }), /no configured/);
  await assert.rejects(() => validateAdvancedBridgeContracts({
    sourceClient: client({ token: APPROVAL, approvalRequired: true, peer: '0x1234' }),
    destinationClient: client({ chainId: 8453, token: DESTINATION }),
    sourceOftAddress: SOURCE,
    destinationOftAddress: DESTINATION,
    ethereumApprovalTokenAddress: APPROVAL,
    sourceChainId: 1,
    destinationChainId: 8453,
  }), /malformed bytes32/);
});

test('advanced policy permits only the reviewed OFT, approval token, and exact spender', () => {
  const policy = advancedBridgePolicy({ walletAddress: WALLET, chainId: 1, sourceOftAddress: SOURCE, ethereumApprovalTokenAddress: APPROVAL });
  assert.deepEqual(policy.allowedDestinations, [SOURCE, APPROVAL]);
  assert.deepEqual(policy.allowedApprovalSpenders, [SOURCE]);
  assert.deepEqual(policy.allowedSelectors?.[SOURCE.toLowerCase()], [OFT_SEND_SELECTOR]);
  assert.deepEqual(policy.allowedSelectors?.[APPROVAL.toLowerCase()], ['0x095ea7b3']);
  const directPolicy = advancedBridgePolicy({ walletAddress: WALLET, chainId: 1, sourceOftAddress: SOURCE, approvalRequired: false });
  assert.deepEqual(directPolicy.allowedDestinations, [SOURCE]);
  assert.deepEqual(directPolicy.allowedApprovalSpenders, []);
});

test('advanced route target must remain bound to the reviewed source OFT', () => {
  const route: PlannedRoute = {
    operation: 'buildBridgeTx',
    chainId: 1,
    walletAddress: WALLET,
    transactions: [{
      chainId: 1,
      from: WALLET,
      to: SOURCE,
      data: `${OFT_SEND_SELECTOR}00` as `0x${string}`,
      value: 1n,
      kind: 'action',
      operation: 'buildBridgeTx',
    }],
  };
  assert.equal(assertBridgeActionTarget(route, SOURCE).to, SOURCE);
  assert.throws(() => assertBridgeActionTarget(route, DESTINATION), /reviewed source OFT/);
});

test('destination verification uses the SDK four-decimal lower bound and fails closed for dust', () => {
  assert.equal(bridgeDeliveryLowerBound(123456789012345n), 100000000000000n);
  assert.throws(() => bridgeDeliveryLowerBound(99999999999999n), /verifiable/);
});

test('canonical Ethereum OFT adapters are distinct from their local balance tokens', () => {
  for (const token of ['fxUSD', 'fxSAVE'] as const) {
    assert.notEqual(
      resolveBridgeTokenAddress(token, 1).toLowerCase(),
      resolveBridgeApprovalTokenAddress(token, 1).toLowerCase(),
    );
    assert.equal(
      resolveBridgeTokenAddress(token, 8453).toLowerCase(),
      resolveBridgeApprovalTokenAddress(token, 8453).toLowerCase(),
    );
  }
});

test('explicit bridge refund addresses are validated before SDK calls', async () => {
  await assert.rejects(() => planBridge({
    sourceChainId: 1,
    destChainId: 8453,
    token: 'fxUSD',
    amount: 10n ** 18n,
    recipient: WALLET,
    walletAddress: WALLET,
    refundAddress: 'not-an-address' as Address,
    destinationOftAddress: DESTINATION,
    destinationBaselineBlock: 0n,
  }), /refund address/);
});
