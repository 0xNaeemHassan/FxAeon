import { formatUnits, type Address } from 'viem';
import { FX_TOKENS, type FxTokenKey } from './fx/tokens';
import { canonicalMoveSourceTokenAddress } from './moveBalances';
import type { UsdPriceSnapshot } from './prices';

export type WalletAssetChain = 1 | 8453;
export type WalletAsset = {
  id: string; chainId: WalletAssetChain; network: 'ethereum' | 'base'; tokenAddress: Address | null;
  canonicalKey: FxTokenKey | null; symbol: string; name: string; decimals: number;
  balanceWei: bigint; balance: string; balanceUpdatedAt: number;
  priceUsd: number | null; priceUpdatedAt: number | null; priceStatus: 'fresh' | 'stale' | 'unavailable';
  usdValue: number | null; logoUrl: string | null; source: 'alchemy' | 'canonical';
};
export type WalletAssetNetwork = { chainId: WalletAssetChain; status: 'ready' | 'partial' | 'unavailable'; error: string };
export type WalletAssetSnapshot = {
  walletAddress: string; assets: WalletAsset[]; networks: Record<WalletAssetChain, WalletAssetNetwork>;
  totalUsdValue: number; unpricedAssetCount: number; updatedAt: number; source: 'alchemy' | 'canonical' | 'mixed';
};
export const ASSET_PRICE_MAX_AGE_MS = 2 * 60_000;
export const ASSET_BALANCE_MAX_AGE_MS = 2 * 60_000;
export const ASSET_DISCOVERY_STALE_MS = 60_000;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const label = (value: unknown, fallback: string, max: number) => typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) || fallback : fallback;

export function canonicalAsset(chainId: WalletAssetChain, address: Address | null): { key: FxTokenKey; decimals: number } | null {
  if (address === null) return { key: 'ETH', decimals: 18 };
  if (chainId === 1) {
    const token = Object.values(FX_TOKENS).find((candidate) => !candidate.native && candidate.address.toLowerCase() === address.toLowerCase());
    return token ? { key: token.key, decimals: token.decimals } : null;
  }
  for (const key of ['fxUSD', 'fxSAVE'] as const) if (canonicalMoveSourceTokenAddress(key, 8453).toLowerCase() === address.toLowerCase()) return { key, decimals: 18 };
  return null;
}

export function parseAssetBalance(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0x[0-9a-f]{1,64}|[0-9]{1,78})$/i.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= (1n << 256n) - 1n ? parsed : null;
}

export function safeAssetLogo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'static.alchemyapi.io' && !url.port && !url.username && !url.password && !url.hash
      ? url.toString() : null;
  } catch { return null; }
}

function valuation(balance: string, price: number | null): number | null {
  if (price === null) return null;
  const value = Number(balance) * price;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function summarizeWalletAssets(snapshot: WalletAssetSnapshot, now = Date.now()): WalletAssetSnapshot {
  const assets = snapshot.assets.map((asset) => {
    const priceStatus = asset.priceUsd === null ? 'unavailable' as const
      : asset.priceUpdatedAt !== null && now - asset.priceUpdatedAt <= ASSET_PRICE_MAX_AGE_MS && asset.priceUpdatedAt <= now + 30_000 ? 'fresh' as const : 'stale' as const;
    const balanceFresh = now - asset.balanceUpdatedAt <= ASSET_BALANCE_MAX_AGE_MS;
    return { ...asset, priceStatus, usdValue: priceStatus === 'fresh' && balanceFresh ? valuation(asset.balance, asset.priceUsd) : null };
  }).sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1) || a.symbol.localeCompare(b.symbol) || a.chainId - b.chainId);
  const rawTotal = assets.reduce((sum, asset) => sum + (asset.usdValue ?? 0), 0);
  return { ...snapshot, assets, totalUsdValue: Number.isFinite(rawTotal) ? rawTotal : 0,
    unpricedAssetCount: assets.filter((asset) => asset.balanceWei > 0n && asset.usdValue === null).length };
}

export function emptyWalletSnapshot(walletAddress: string, now = Date.now()): WalletAssetSnapshot {
  return { walletAddress: walletAddress.toLowerCase(), assets: [],
    networks: { 1: { chainId: 1, status: 'unavailable', error: 'Ethereum assets could not be refreshed.' }, 8453: { chainId: 8453, status: 'unavailable', error: 'Base assets could not be refreshed.' } },
    totalUsdValue: 0, unpricedAssetCount: 0, updatedAt: now, source: 'canonical' };
}

/** Indexed balances are display data only. Canonical identities never come from a symbol. */
export function parseAlchemyWalletAssets(payload: unknown, walletAddress: string, now = Date.now()): WalletAssetSnapshot {
  if (!ADDRESS.test(walletAddress)) throw new Error('Invalid wallet address.');
  const root = record(payload), data = record(root?.data);
  if (!data || !Array.isArray(data.tokens)) throw new Error('Wallet assets could not be loaded.');
  const snapshot = emptyWalletSnapshot(walletAddress, now);
  snapshot.source = 'alchemy';
  snapshot.networks = { 1: { chainId: 1, status: 'ready', error: '' }, 8453: { chainId: 8453, status: 'ready', error: '' } };
  const failures = record(root?.error)?.partialErrors;
  if (root?.error && !Array.isArray(failures)) throw new Error('Wallet assets could not be loaded.');
  if (Array.isArray(failures)) for (const failure of failures) {
    const network = record(failure)?.network;
    const chainId = network === 'eth-mainnet' ? 1 : network === 'base-mainnet' ? 8453 : null;
    if (chainId) snapshot.networks[chainId] = { chainId, status: 'unavailable', error: `${chainId === 1 ? 'Ethereum' : 'Base'} assets could not be refreshed.` };
    else for (const id of [1, 8453] as const) snapshot.networks[id] = { chainId: id, status: 'partial', error: 'Some assets could not be refreshed.' };
  }
  const assets = new Map<string, WalletAsset>();
  const conflictedAssets = new Set<string>();
  for (const raw of data.tokens) {
    const row = record(raw);
    if (!row || typeof row.address !== 'string' || row.address.toLowerCase() !== walletAddress.toLowerCase()) continue;
    const chainId = row.network === 'eth-mainnet' ? 1 : row.network === 'base-mainnet' ? 8453 : null;
    if (!chainId || snapshot.networks[chainId].status === 'unavailable') continue;
    const tokenAddress = row.tokenAddress === null ? null : typeof row.tokenAddress === 'string' && ADDRESS.test(row.tokenAddress) ? row.tokenAddress.toLowerCase() as Address : undefined;
    const balanceWei = parseAssetBalance(row.tokenBalance), metadata = record(row.tokenMetadata);
    const canonical = tokenAddress !== undefined ? canonicalAsset(chainId, tokenAddress) : null;
    const decimals = canonical?.decimals ?? metadata?.decimals;
    if (tokenAddress === undefined || balanceWei === null || !Number.isInteger(decimals) || Number(decimals) < 0 || Number(decimals) > 255) {
      snapshot.networks[chainId] = { chainId, status: 'partial', error: 'Some assets could not be refreshed.' }; continue;
    }
    if (balanceWei === 0n) continue;
    let priceUsd: number | null = null, priceUpdatedAt: number | null = null;
    if (Array.isArray(row.tokenPrices)) for (const rawPrice of row.tokenPrices) {
      const price = record(rawPrice);
      if (price?.currency !== 'usd' || typeof price.value !== 'string' || !/^[0-9]+(?:\.[0-9]+)?$/.test(price.value) || typeof price.lastUpdatedAt !== 'string') continue;
      const value = Number(price.value), timestamp = Date.parse(price.lastUpdatedAt);
      if (value > 0 && Number.isFinite(value) && Number.isFinite(timestamp) && timestamp <= now + 30_000 && timestamp > (priceUpdatedAt ?? 0)) { priceUsd = value; priceUpdatedAt = timestamp; }
    }
    const id = `${chainId}:${tokenAddress ?? 'native'}`;
    if (conflictedAssets.has(id)) continue;
    const candidate: WalletAsset = { id, chainId, network: chainId === 1 ? 'ethereum' : 'base', tokenAddress, canonicalKey: canonical?.key ?? null,
      symbol: canonical?.key ?? label(metadata?.symbol, 'Token', 24), name: label(metadata?.name, canonical?.key ?? 'Unknown token', 80), decimals: Number(decimals),
      balanceWei, balance: formatUnits(balanceWei, Number(decimals)), balanceUpdatedAt: now,
      priceUsd, priceUpdatedAt, priceStatus: 'unavailable', usdValue: null, logoUrl: safeAssetLogo(metadata?.logo), source: 'alchemy' };
    const existing = assets.get(id);
    if (!existing) assets.set(id, candidate);
    else if (existing.balanceWei !== candidate.balanceWei || existing.decimals !== candidate.decimals) {
      // Conflicting duplicates cannot be added, guessed, or resolved by arrival order.
      assets.delete(id); snapshot.networks[chainId] = { chainId, status: 'partial', error: 'Some assets could not be refreshed.' };
      conflictedAssets.add(id);
    }
  }
  snapshot.assets = [...assets.values()];
  return summarizeWalletAssets(snapshot, now);
}

export function alchemyDataApiKey(value = process.env.NEXT_PUBLIC_ALCHEMY_DATA_API_KEY): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value) && !/your_|placeholder|example/i.test(value) ? value : null;
}

export async function fetchAlchemyWalletAssets(walletAddress: string, signal?: AbortSignal, request: typeof fetch = fetch, key = alchemyDataApiKey()): Promise<WalletAssetSnapshot> {
  if (!key || !ADDRESS.test(walletAddress)) throw new Error('Expanded wallet assets are unavailable.');
  let pageKey: string | undefined;
  let merged: WalletAssetSnapshot | null = null;
  const conflictedAssets = new Set<string>();
  const seenPages = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    signal?.throwIfAborted();
    const response = await request(`https://api.g.alchemy.com/data/v1/${key}/assets/tokens/by-address`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', credentials: 'omit',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      body: JSON.stringify({ addresses: [{ address: walletAddress, networks: ['eth-mainnet', 'base-mainnet'] }],
        withMetadata: true, withPrices: true, includeNativeTokens: true, includeErc20Tokens: true, includeBlockMetadata: false, ...(pageKey ? { pageKey } : {}) }),
    });
    if (!response.ok) throw new Error('Expanded wallet assets are temporarily unavailable.');
    const payload: unknown = await response.json(); signal?.throwIfAborted();
    const parsed = parseAlchemyWalletAssets(payload, walletAddress);
    if (!merged) merged = parsed;
    else {
      const assets = new Map(merged.assets.map((asset) => [asset.id, asset]));
      for (const asset of parsed.assets) {
        if (conflictedAssets.has(asset.id)) continue;
        const existing = assets.get(asset.id);
        if (!existing) assets.set(asset.id, asset);
        else if (existing.balanceWei !== asset.balanceWei || existing.decimals !== asset.decimals) {
          assets.delete(asset.id); conflictedAssets.add(asset.id);
          merged.networks[asset.chainId] = { chainId: asset.chainId, status: 'partial', error: 'Some assets could not be refreshed.' };
        }
      }
      merged.assets = [...assets.values()];
      for (const chainId of [1, 8453] as const) if (parsed.networks[chainId].status !== 'ready') merged.networks[chainId] = parsed.networks[chainId];
    }
    const next = record(record(payload)?.data)?.pageKey;
    if (typeof next !== 'string' || !next) return summarizeWalletAssets(merged);
    if (seenPages.has(next) || next.length > 4096) break;
    seenPages.add(next); pageKey = next;
  }
  if (!merged) throw new Error('Expanded wallet assets could not be loaded.');
  for (const chainId of [1, 8453] as const) merged.networks[chainId] = { chainId, status: 'partial', error: 'More assets are available. Refresh to try again.' };
  return summarizeWalletAssets(merged);
}

export type CanonicalAssetRead = { chainId: WalletAssetChain; balances: { key: FxTokenKey; address: Address | null; decimals: number; amountWei: bigint }[]; failedTokens: FxTokenKey[]; updatedAt: number };

export function mergeCanonicalWalletAssets(indexed: WalletAssetSnapshot | null, walletAddress: string, canonical: readonly CanonicalAssetRead[], prices: UsdPriceSnapshot, now = Date.now()): WalletAssetSnapshot {
  const snapshot = indexed?.walletAddress === walletAddress.toLowerCase() ? { ...indexed, networks: { ...indexed.networks } } : emptyWalletSnapshot(walletAddress, now);
  // Remove every indexed canonical token, including failed exact reads. An indexer
  // must never silently revive a stale canonical amount after an RPC failure.
  const assets = new Map(snapshot.assets.filter((asset) => asset.canonicalKey === null).map((asset) => [asset.id, asset]));
  for (const read of canonical) {
    const indexedStatus = snapshot.networks[read.chainId].status;
    snapshot.networks[read.chainId] = read.failedTokens.length
      ? { chainId: read.chainId, status: 'partial', error: 'Some balances could not be refreshed.' }
      : indexedStatus !== 'ready'
        ? { chainId: read.chainId, status: 'partial', error: 'Some assets could not be refreshed.' }
        : { chainId: read.chainId, status: 'ready', error: '' };
    for (const balance of read.balances) {
      if (balance.amountWei <= 0n) continue;
      const id = `${read.chainId}:${balance.address?.toLowerCase() ?? 'native'}`;
      const candidate = prices.prices[balance.key];
      const priceUsd = candidate && Number.isFinite(candidate) && candidate > 0 ? candidate : null;
      assets.set(id, { id, chainId: read.chainId, network: read.chainId === 1 ? 'ethereum' : 'base', tokenAddress: balance.address,
        canonicalKey: balance.key, symbol: balance.key, name: balance.key === 'ETH' ? 'Ethereum' : balance.key, decimals: balance.decimals,
        balanceWei: balance.amountWei, balance: formatUnits(balance.amountWei, balance.decimals), balanceUpdatedAt: read.updatedAt,
        priceUsd, priceUpdatedAt: prices.updatedAt, priceStatus: prices.status === 'stale' ? 'stale' : 'unavailable', usdValue: null,
        logoUrl: null, source: 'canonical' });
    }
  }
  return summarizeWalletAssets({ ...snapshot, assets: [...assets.values()], source: indexed ? 'mixed' : 'canonical', updatedAt: Math.max(snapshot.updatedAt, ...canonical.map((read) => read.updatedAt)) }, now);
}
