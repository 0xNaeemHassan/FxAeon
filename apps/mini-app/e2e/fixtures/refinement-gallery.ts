import type { Page, Route } from '@playwright/test';
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, toFunctionSelector } from 'viem';
import { resolveBridgeTokenAddress } from '../../src/lib/fx';
import { FX_TOKENS, type FxTokenKey } from '../../src/lib/fx/tokens';
import { positionPoolAddress } from '../../src/lib/fx/policy';
import type { FxChainId } from '../../src/lib/fx/types';

const erc20Balances: Partial<Record<FxTokenKey, bigint>> = {
  WETH: 400_000_000_000_000_000n,
  wstETH: 250_000_000_000_000_000n,
  stETH: 150_000_000_000_000_000n,
  WBTC: 30_000n,
  USDC: 4_500_000_000n,
  USDT: 1_250_000_000n,
  fxUSD: 1_200_000_000_000_000_000_000n,
  fxUSDBasePool: 400_000_000_000_000_000n,
  fxSAVE: 600_000_000_000_000_000_000n,
  FXN: 200_000_000_000_000_000_000n,
};

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function tokenBalance(address: string | undefined, chainId: FxChainId): bigint | undefined {
  // Pair the explicit empty index with the canonical NFT counts. Unknown
  // contracts still fail instead of silently inventing an empty portfolio.
  if (chainId === 1 && (['ETH', 'BTC'] as const).some((market) =>
    (['long', 'short'] as const).some((side) => positionPoolAddress(market, side).toLowerCase() === address?.toLowerCase()))) return 0n;
  const token = Object.values(FX_TOKENS).find((item) => item.address.toLowerCase() === address?.toLowerCase());
  if (token && chainId === 1) return erc20Balances[token.key] ?? 0n;
  if (chainId === 8453) {
    for (const key of ['fxUSD', 'fxSAVE'] as const) {
      if (resolveBridgeTokenAddress(key, chainId).toLowerCase() === address?.toLowerCase()) return 0n;
    }
  }
  return undefined;
}

function rpcResult(method: string, params: unknown[], chainId: FxChainId): unknown {
  if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
  if (method === 'eth_blockNumber') return '0x1430f00';
  if (method === 'eth_getBalance') return `0x${(1_250_000_000_000_000_000n).toString(16)}`;
  if (method === 'eth_getLogs') return [];
  if (method === 'eth_getCode') return '0x';
  if (method !== 'eth_call') throw new Error(`gallery RPC fixture does not define ${method}`);

  const call = params[0] as { to?: string; data?: string } | undefined;
  const selector = call?.data?.slice(0, 10).toLowerCase();
  if (selector === '0x82ad56cb' && call?.data) {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data as `0x${string}` });
    if (decoded.functionName === 'aggregate3') {
      const results = decoded.args[0].map((subcall) => {
        try {
          // Nested multicalls are not part of this read-only fixture.
          if (subcall.callData.slice(0, 10) === '0x82ad56cb') throw new Error('nested multicall');
          return { success: true, returnData: rpcResult('eth_call', [{ to: subcall.target, data: subcall.callData }], chainId) as `0x${string}` };
        } catch {
          return { success: false, returnData: '0x' as `0x${string}` };
        }
      });
      return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: results });
    }
  }
  // Only explicitly modeled token balance reads receive financial values.
  if (selector === '0x70a08231') {
    const balance = tokenBalance(call?.to, chainId);
    if (balance !== undefined) return `0x${word(balance)}`;
    throw new Error(`gallery RPC fixture does not define balanceOf for ${call?.to ?? 'unknown token'}`);
  }
  if (call?.to?.toLowerCase() === FX_TOKENS.fxSAVE.address.toLowerCase()
    && selector === toFunctionSelector('convertToAssets(uint256)')) {
    return `0x${word(BigInt(`0x${call.data?.slice(10) ?? '0'}`))}`;
  }
  if (call?.to?.toLowerCase() === FX_TOKENS.fxSAVE.address.toLowerCase()
    && selector === toFunctionSelector('lockedProxy(address)')) return `0x${word(0n)}`;
  if (call?.to?.toLowerCase() === FX_TOKENS.fxSAVE.address.toLowerCase()) {
    const vaultReads: Record<string, bigint> = {
      [toFunctionSelector('totalSupply()')]: 1_000_000n * 10n ** 18n,
      [toFunctionSelector('totalAssets()')]: 1_000_000n * 10n ** 18n,
      [toFunctionSelector('getExpenseRatio()')]: 10n ** 17n,
      [toFunctionSelector('getHarvesterRatio()')]: 10n ** 16n,
      [toFunctionSelector('getThreshold()')]: 10n ** 18n,
    };
    if (selector && vaultReads[selector] !== undefined) return `0x${word(vaultReads[selector])}`;
  }
  if (call?.to?.toLowerCase() === FX_TOKENS.fxUSDBasePool.address.toLowerCase()
    && selector === toFunctionSelector('redeemCoolDownPeriod()')) return `0x${word(259_200n)}`;
  if (call?.to?.toLowerCase() === FX_TOKENS.fxUSDBasePool.address.toLowerCase()
    && selector === toFunctionSelector('instantRedeemFeeRatio()')) return `0x${word(5n * 10n ** 15n)}`;
  throw new Error(`gallery RPC fixture does not define ${method} read ${selector ?? 'without selector'}`);
}

async function fulfillRpc(route: Route, chainId: FxChainId): Promise<void> {
  let payload: unknown;
  try { payload = route.request().postDataJSON(); } catch { payload = null; }
  const requests = Array.isArray(payload) ? payload : [payload];
  const response = requests.map((request) => {
    const item = request as { id?: unknown; method?: unknown; params?: unknown[] } | null;
    const method = typeof item?.method === 'string' ? item.method : '';
    try {
      return { jsonrpc: '2.0', id: item?.id ?? null, result: rpcResult(method, item?.params ?? [], chainId) };
    } catch (reason) {
      return { jsonrpc: '2.0', id: item?.id ?? null, error: { code: -32000, message: reason instanceof Error ? reason.message : String(reason) } };
    }
  });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.isArray(payload) ? response : response[0]) });
}

/** Deterministic, read-only gallery values; position groups are ready-empty from the explicit index fixture. */
export async function installRefinementGalleryFixtures(page: Page): Promise<void> {
  await page.routeWebSocket(/^wss:\/\/(eth|base)-mainnet\.g\.alchemy\.com\/v2\//, (socket) => {
    socket.onMessage((message) => {
      const request = JSON.parse(String(message)) as { id: number; method: string };
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id,
        ...(request.method === 'eth_subscribe' ? { result: `0x${request.id.toString(16)}` }
          : request.method === 'eth_unsubscribe' ? { result: true }
            : { error: { code: -32601, message: 'Unsupported gallery subscription method' } }),
      }));
    });
  });
  await page.route('https://eth-mainnet.g.alchemy.com/v2/**', (route) => fulfillRpc(route, 1));
  await page.route('https://base-mainnet.g.alchemy.com/v2/**', (route) => fulfillRpc(route, 8453));
  await page.route('https://api.goldsky.com/api/public/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { positions: [], orders: [] } }),
  }));
}
