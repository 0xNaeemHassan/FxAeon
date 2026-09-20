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
export type WalletAssetNetwork = { chainId: WalletAssetChain; status: 'pending' | 'ready' | 'partial' | 'unavailable'; error: string };
export type WalletAssetSnapshot = {
  walletAddress: string; assets: WalletAsset[]; networks: Record<WalletAssetChain, WalletAssetNetwork>;
  totalUsdValue: number; unpricedAssetCount: number; updatedAt: number; source: 'alchemy' | 'canonical' | 'mixed';
};
export type WalletAssetCountState = 'loading' | 'unavailable' | 'partial' | 'ready';
export type WalletAssetValuation = {
  complete: boolean;
  totalUsd: number | null;
  assetCount: number;
  unpricedAssetCount: number;
  reason: string;
};
export const ASSET_PRICE_MAX_AGE_MS = 2 * 60_000;
export const ASSET_BALANCE_MAX_AGE_MS = 2 * 60_000;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const label = (value: unknown, fallback: string, max: number) => typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) || fallback : fallback;

export function walletAssetCountLabel(count: number, state: WalletAssetCountState): string {
  if (state !== 'ready') return '—';
  return `${count} ${count === 1 ? 'asset' : 'assets'}`;
}

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

/**
 * The single display valuation used by Portfolio and the wallet profile.
 * `totalUsdValue` is the sum of rows that currently have fresh validated
 * values, while `complete` gates whether that sum may be presented as the
 * wallet total. No surface should invent a zero for a pending network or an
 * unpriced asset.
 */
export function walletAssetValuation(snapshot: WalletAssetSnapshot | null): WalletAssetValuation {
  if (!snapshot) {
    return { complete: false, totalUsd: null, assetCount: 0, unpricedAssetCount: 0, reason: '' };
  }
  const assetCount = snapshot.assets.filter((asset) => asset.balanceWei > 0n).length;
  const unpricedAssetCount = snapshot.unpricedAssetCount;
  const incompleteNetworks = Object.values(snapshot.networks).filter((network) => network.status !== 'ready');
  const reasons: string[] = [];
  if (unpricedAssetCount > 0) {
    reasons.push(`${unpricedAssetCount} ${unpricedAssetCount === 1 ? 'asset is' : 'assets are'} waiting for a verified USD value.`);
  }
  if (incompleteNetworks.length > 0) {
    // Keep incomplete network reads represented by the incomplete flag while
    // leaving transient diagnostics out of the user-facing valuation copy.
  }
  const complete = reasons.length === 0 && incompleteNetworks.length === 0;
  return {
    complete,
    // A sum of independently verified rows is useful for sorting and row
    // details, but it is not a wallet total until every declared network and
    // held row is complete. Callers can therefore render a literal "$" while
    // refresh or discovery is incomplete instead of exposing a partial total.
    totalUsd: complete && Number.isFinite(snapshot.totalUsdValue) ? snapshot.totalUsdValue : null,
    assetCount,
    unpricedAssetCount,
    reason: reasons.join(' '),
  };
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
  const topLevelError = record(root?.error);
  const failures = topLevelError?.partialErrors;
  if (root?.error && !Array.isArray(failures)) throw new Error('Wallet assets could not be loaded.');
  if (topLevelError && Array.isArray(failures) && failures.length === 0) {
    // An error object without a useful network list is still an incomplete
    // multichain response. Fail closed instead of treating HTTP 200 as full
    // success with an invented zero for both networks.
    for (const id of [1, 8453] as const) snapshot.networks[id] = { chainId: id, status: 'partial', error: 'Some assets could not be refreshed.' };
  }
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
    // A token row can carry an independent metadata/pricing error while its
    // balance is still valid. Keep the balance visible, but leave its USD
    // value unpriced and mark only that network partial.
    const tokenError = row.error !== undefined && row.error !== null;
    if (tokenError) snapshot.networks[chainId] = { chainId, status: 'partial', error: 'Some token metadata or prices could not be refreshed.' };
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

type AlchemyNetwork = 'eth-mainnet' | 'base-mainnet';
const ALCHEMY_NETWORKS: readonly AlchemyNetwork[] = ['eth-mainnet', 'base-mainnet'];
const chainForAlchemyNetwork = (network: AlchemyNetwork): WalletAssetChain => network === 'eth-mainnet' ? 1 : 8453;

function partialErrorNetworks(payload: unknown): AlchemyNetwork[] {
  const root = record(payload);
  const partialErrors = record(root?.error)?.partialErrors;
  if (!Array.isArray(partialErrors)) return [];
  return [...new Set(partialErrors.map((item) => record(item)?.network).filter(
    (network): network is AlchemyNetwork => network === 'eth-mainnet' || network === 'base-mainnet',
  ))];
}

function mergeAlchemyPage(
  target: WalletAssetSnapshot,
  page: WalletAssetSnapshot,
  networks: readonly AlchemyNetwork[],
  replaceNetworks: ReadonlySet<AlchemyNetwork> = new Set(),
  conflicts: Set<string> = new Set(),
): void {
  const selectedChains = new Set(networks.map(chainForAlchemyNetwork));
  const assets = new Map(target.assets.map((asset) => [asset.id, asset]));
  for (const network of networks) {
    const chainId = chainForAlchemyNetwork(network);
    if (replaceNetworks.has(network) && page.networks[chainId].status !== 'unavailable') {
      for (const asset of assets.values()) if (asset.chainId === chainId) assets.delete(asset.id);
    }
    const current = target.networks[chainId];
    const next = page.networks[chainId];
    // A page carrying a token-level failure makes the whole network partial;
    // a later page with no error must not erase that diagnostic.
    target.networks[chainId] = replaceNetworks.has(network) || current.status === 'ready' || next.status !== 'ready'
      ? next : current;
  }
  for (const asset of page.assets) {
    if (!selectedChains.has(asset.chainId) || conflicts.has(asset.id)) continue;
    const existing = assets.get(asset.id);
    if (!existing) assets.set(asset.id, asset);
    else if (existing.balanceWei !== asset.balanceWei || existing.decimals !== asset.decimals) {
      assets.delete(asset.id);
      conflicts.add(asset.id);
      target.networks[asset.chainId] = { chainId: asset.chainId, status: 'partial', error: 'Some assets could not be refreshed.' };
    }
  }
  target.assets = [...assets.values()];
  target.updatedAt = Math.max(target.updatedAt, page.updatedAt);
}

export async function fetchAlchemyWalletAssets(walletAddress: string, signal?: AbortSignal, request: typeof fetch = fetch, key = alchemyDataApiKey()): Promise<WalletAssetSnapshot> {
  if (!key || !ADDRESS.test(walletAddress)) throw new Error('Expanded wallet assets are unavailable.');
  const fetchNetworkPages = async (networks: readonly AlchemyNetwork[], onPage: (page: WalletAssetSnapshot, firstPage: boolean, failures: readonly AlchemyNetwork[]) => void) => {
    let pageKey: string | undefined;
    const seenPages = new Set<string>();
    for (let page = 0; page < 20; page += 1) {
      signal?.throwIfAborted();
      let response: Response;
      try {
        response = await request(`https://api.g.alchemy.com/data/v1/${key}/assets/tokens/by-address`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', credentials: 'omit',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
          body: JSON.stringify({ addresses: [{ address: walletAddress, networks }],
            withMetadata: true, withPrices: true, includeNativeTokens: true, includeErc20Tokens: true, includeBlockMetadata: false, ...(pageKey ? { pageKey } : {}) }),
        });
      } catch (cause) {
        signal?.throwIfAborted();
        if (page === 0) throw cause;
        const failure = { data: { tokens: [] }, error: { partialErrors: networks.map((network) => ({ network })) } };
        onPage(parseAlchemyWalletAssets(failure, walletAddress), false, [...networks]);
        return;
      }
      if (!response.ok) {
        if (page === 0) throw new Error('Expanded wallet assets are temporarily unavailable.');
        const failure = { data: { tokens: [] }, error: { partialErrors: networks.map((network) => ({ network })) } };
        onPage(parseAlchemyWalletAssets(failure, walletAddress), false, [...networks]);
        return;
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (cause) {
        signal?.throwIfAborted();
        if (page === 0) throw cause;
        const failure = { data: { tokens: [] }, error: { partialErrors: networks.map((network) => ({ network })) } };
        onPage(parseAlchemyWalletAssets(failure, walletAddress), false, [...networks]);
        return;
      }
      signal?.throwIfAborted();
      let parsed: WalletAssetSnapshot;
      try {
        parsed = parseAlchemyWalletAssets(payload, walletAddress);
      } catch (cause) {
        signal?.throwIfAborted();
        if (page === 0) throw cause;
        const failure = { data: { tokens: [] }, error: { partialErrors: networks.map((network) => ({ network })) } };
        onPage(parseAlchemyWalletAssets(failure, walletAddress), false, [...networks]);
        return;
      }
      onPage(parsed, page === 0, partialErrorNetworks(payload));
      const next = record(record(payload)?.data)?.pageKey;
      if (typeof next !== 'string' || !next) return;
      if (seenPages.has(next) || next.length > 4096) {
        const failure = { data: { tokens: [] }, error: { partialErrors: networks.map((network) => ({ network })) } };
        onPage(parseAlchemyWalletAssets(failure, walletAddress), false, [...networks]);
        return;
      }
      seenPages.add(next); pageKey = next;
    }
    const failure = { data: { tokens: [] }, error: { partialErrors: networks.map((network) => ({ network })) } };
    onPage(parseAlchemyWalletAssets(failure, walletAddress), false, [...networks]);
  };

  let merged: WalletAssetSnapshot | null = null;
  const failedNetworks = new Set<AlchemyNetwork>();
  const initialConflicts = new Set<string>();
  await fetchNetworkPages(ALCHEMY_NETWORKS, (page, _firstPage, pageFailures) => {
    pageFailures.forEach((network) => failedNetworks.add(network));
    if (!merged) merged = page;
    else {
      // Failed networks are absent from subsequent paginated responses. Keep
      // their unavailable status and merge only the networks that still have
      // a page stream; a later page must not resurrect the failed network.
      mergeAlchemyPage(merged, page, ALCHEMY_NETWORKS.filter((network) => !failedNetworks.has(network)), new Set(), initialConflicts);
      for (const network of pageFailures) merged.networks[chainForAlchemyNetwork(network)] = page.networks[chainForAlchemyNetwork(network)];
    }
  });

  // Alchemy deliberately drops failed networks from later page responses.
  // Retry each one as a fresh, single-network request so a healthy network's
  // pagination cannot mask a failed network forever. One bounded retry keeps
  // a persistently failing upstream from blocking the usable partial result.
  for (const network of failedNetworks) {
    try {
      const retryConflicts = new Set<string>();
      await fetchNetworkPages([network], (page, firstPage, pageFailures) => {
        pageFailures.forEach((failed) => failedNetworks.add(failed));
        if (!merged) merged = page;
        else mergeAlchemyPage(merged, page, [network], firstPage ? new Set([network]) : new Set(), retryConflicts);
      });
      // A retry response that still contains a top-level failure remains
      // unavailable; parseAlchemyWalletAssets records that status explicitly.
    } catch {
      // Preserve successful pages and the unavailable network status below.
    }
  }
  const result = merged as WalletAssetSnapshot | null;
  if (!result) throw new Error('Expanded wallet assets could not be loaded.');
  for (const network of failedNetworks) {
    const chainId = chainForAlchemyNetwork(network);
    if (result.networks[chainId].status === 'unavailable') continue;
    // Successful fresh retry resolves the initial top-level failure. A token
    // metadata/pricing error still correctly leaves this network partial.
    if (result.networks[chainId].status !== 'partial') result.networks[chainId] = { chainId, status: 'ready', error: '' };
  }
  return summarizeWalletAssets(result);
}

export type CanonicalAssetRead = { chainId: WalletAssetChain; balances: { key: FxTokenKey; address: Address | null; decimals: number; amountWei: bigint }[]; failedTokens: FxTokenKey[]; updatedAt: number; status?: 'pending' | 'ready' | 'partial' | 'unavailable' };

export function mergeCanonicalWalletAssets(indexed: WalletAssetSnapshot | null, walletAddress: string, canonical: readonly CanonicalAssetRead[], prices: UsdPriceSnapshot, now = Date.now()): WalletAssetSnapshot {
  const snapshot = indexed?.walletAddress === walletAddress.toLowerCase() ? { ...indexed, networks: { ...indexed.networks } } : emptyWalletSnapshot(walletAddress, now);
  // Keep indexed rows until an exact read proves their replacement. This is
  // important during a background refresh: a pending query is not a zero read,
  // and an unavailable query must not make a verified account row disappear.
  const assets = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  const canonicalChains = new Set(canonical.map((read) => read.chainId));
  // An Alchemy snapshot is useful discovery data, but its `ready` flags do
  // not prove that the exact balance readers have completed. Keep a network
  // incomplete until its first canonical read arrives; once a prior mixed
  // snapshot exists, preserve that network's verified state during a partial
  // update.
  if (indexed?.source === 'alchemy') for (const chainId of [1, 8453] as const) {
    if (!canonicalChains.has(chainId) && snapshot.networks[chainId].status === 'ready') {
      snapshot.networks[chainId] = { chainId, status: 'pending', error: 'Canonical balances are still being verified.' };
    }
  }
  for (const read of canonical) {
    const indexedStatus = snapshot.networks[read.chainId].status;
    // Retain the previous row's validated quote and metadata while replacing
    // the authoritative balance set. Deleting rows first is correct for
    // exact zero reads, but must not erase the fallback row before a positive
    // canonical balance can reuse its still-valid USD timestamp.
    const priorAssets = new Map(assets);
    snapshot.networks[read.chainId] = read.status === 'pending'
      ? { chainId: read.chainId, status: 'pending', error: 'Canonical balances are still being verified.' }
      : read.status === 'unavailable'
        ? { chainId: read.chainId, status: 'unavailable', error: 'Canonical balances could not be refreshed.' }
        : read.failedTokens.length
      ? { chainId: read.chainId, status: 'partial', error: 'Some balances could not be refreshed.' }
      : indexed?.source === 'alchemy' && indexedStatus !== 'ready'
      ? { chainId: read.chainId, status: 'partial', error: 'Some assets could not be refreshed.' }
        : { chainId: read.chainId, status: 'ready', error: '' };
    const pending = read.status === 'pending';
    const unavailable = read.status === 'unavailable';
    const failed = new Set(read.failedTokens);
    // A ready read is authoritative for the complete supported token set. A
    // partial read is authoritative only for successful token rows; failed
    // tokens retain their prior row until a later read verifies their balance.
    if (!pending && !unavailable && failed.size === 0) {
      for (const existing of assets.values()) {
        if (existing.chainId === read.chainId && existing.canonicalKey !== null) assets.delete(existing.id);
      }
    }
    // A pending or unavailable response may expose TanStack Query's previous
    // data. That data remains displayable from `assets`, but it is not a new
    // exact read: do not rewrite balance or price timestamps from it.
    if (pending || unavailable) continue;
    for (const balance of read.balances) {
      const id = `${read.chainId}:${balance.address?.toLowerCase() ?? 'native'}`;
      if (balance.amountWei <= 0n) {
        assets.delete(id);
        continue;
      }
      const indexedAsset = priorAssets.get(id);
      const candidate = prices.prices[balance.key];
      const candidateUpdatedAt = prices.updatedAts?.[balance.key] ?? prices.updatedAt;
      const hasCurrentPrice = prices.status !== 'stale'
        && prices.status !== 'unavailable'
        && prices.status !== 'loading'
        && typeof candidateUpdatedAt === 'number'
        && Number.isFinite(candidateUpdatedAt)
        && candidateUpdatedAt > 0
        && candidate !== undefined && Number.isFinite(candidate) && candidate > 0;
      const priceUsd = hasCurrentPrice ? candidate : indexedAsset?.priceUsd ?? null;
      // Never re-stamp an indexed quote with the current price snapshot when
      // the snapshot does not contain a matching token. Its original age is
      // what keeps stale cached USD rows from becoming fresh by accident.
      const priceUpdatedAt = hasCurrentPrice ? candidateUpdatedAt : indexedAsset?.priceUpdatedAt ?? null;
      assets.set(id, { id, chainId: read.chainId, network: read.chainId === 1 ? 'ethereum' : 'base', tokenAddress: balance.address,
        canonicalKey: balance.key, symbol: balance.key, name: balance.key === 'ETH' ? 'Ethereum' : balance.key, decimals: balance.decimals,
        balanceWei: balance.amountWei, balance: formatUnits(balance.amountWei, balance.decimals), balanceUpdatedAt: read.updatedAt,
        priceUsd, priceUpdatedAt, priceStatus: prices.status === 'stale' ? 'stale' : 'unavailable', usdValue: null,
        logoUrl: indexedAsset?.logoUrl ?? null, source: 'canonical' });
    }
  }
  const hasIndexed = indexed?.source === 'alchemy' || indexed?.source === 'mixed';
  const hasCanonical = canonical.length > 0 || indexed?.source === 'canonical' || indexed?.source === 'mixed';
  const source: WalletAssetSnapshot['source'] = hasIndexed && hasCanonical ? 'mixed' : hasIndexed ? 'alchemy' : 'canonical';
  return summarizeWalletAssets({ ...snapshot, assets: [...assets.values()], source, updatedAt: Math.max(snapshot.updatedAt, ...canonical.map((read) => read.updatedAt)) }, now);
}
