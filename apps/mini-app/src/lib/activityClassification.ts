import { formatUnits, getAddress, isAddress, type Address } from 'viem';
import { formatSignificantDecimal } from './amount';
import { callSelector, decodeActivityCall, type DecodedActivityCall } from './activityCalldata';
import { compactAddress } from './addressPresentation';
import { FX_TOKENS } from '@/lib/fx/tokens';
import { APPROVE, FX_MINT_ROUTER_ADDRESS, FX_ROUTER_ADDRESS, OFT_SEND, canonicalBridgeTarget, positionPoolAddress } from '@/lib/fx/policy';

/**
 * Pure explanation of one wallet transaction for History.
 *
 * Every fact here is display data: the journal, protocol index, calldata, and
 * indexed transfers only decide which sentence describes what already
 * happened. Nothing in this module establishes a balance or authorizes a step.
 */
export type ActivityKind =
  | 'open' | 'increase' | 'reduce' | 'close' | 'adjust'
  | 'deposit' | 'withdraw' | 'queueWithdrawal' | 'claim'
  | 'borrow' | 'repay' | 'addCollateral' | 'withdrawCollateral'
  | 'bridgeOut' | 'bridgeIn' | 'approve' | 'swap' | 'send' | 'receive'
  | 'wrap' | 'unwrap' | 'contract' | 'failed';
export type ActivityGlyph = 'send' | 'receive' | 'swap' | 'move' | 'long' | 'short' | 'earn' | 'borrow' | 'approve' | 'contract';
export type ActivityStatus = 'confirmed' | 'failed' | 'pending' | 'indexed';
export type ActivityChain = 1 | 8453;
type Market = 'ETH' | 'BTC';
type Side = 'long' | 'short';
type ActionKind = Exclude<ActivityKind, 'failed'>;

export type ActivityTransferInput = {
  /** null is the chain's native ETH. */
  token: Address | null;
  symbol: string;
  /** null when an unverified token's decimals are unknown. */
  decimals: number | null;
  amountRaw: bigint;
  direction: 'in' | 'out';
  counterparty: Address;
  /** Canonical FxAeon asset. Unverified tokens are never priced. */
  verified: boolean;
};
export type ActivityNftInput = { pool: Address; tokenId: bigint; direction: 'in' | 'out'; counterparty: Address };
export type ActivityCallInput = { from?: Address | null; to?: Address | null; selector?: string | null; input?: string | null; value?: bigint | null };
export type ActivityJournalInput = {
  intent?: string;
  operation?: string;
  stepKind?: 'approval' | 'action' | 'unknown';
  to?: Address;
  bridge?: { destinationChainId?: number; bridgeToken?: string };
};
export type ActivityProtocolInput = { market: Market; side: Side; kind: 'open' | 'reduce' | 'close'; positionId?: number };

export type ActivityClassificationInput = {
  chainId: ActivityChain;
  hash: string;
  timestamp: number;
  wallet: Address;
  status: ActivityStatus;
  call?: ActivityCallInput;
  journal?: ActivityJournalInput;
  protocol?: readonly ActivityProtocolInput[];
  nfts?: readonly ActivityNftInput[];
  transfers: readonly ActivityTransferInput[];
};

export type ActivityFlow = {
  token: Address | null;
  symbol: string;
  decimals: number | null;
  verified: boolean;
  /** Net movement for the wallet, always positive; direction is the list it is in. */
  amountRaw: bigint;
  /** Display amount (5 significant digits, truncated); null when decimals are unknown. */
  amount: string | null;
  /** Exact decimal amount; null when decimals are unknown. */
  exact: string | null;
  counterparties: Address[];
};

export type ActivityCounterparty = { label: string; address: Address; known: boolean };

export type ActivityClassification = {
  kind: ActivityKind;
  /** What a failed transaction tried to do. */
  attempted?: ActionKind;
  title: string;
  summary: string;
  flowsIn: ActivityFlow[];
  flowsOut: ActivityFlow[];
  counterparty?: ActivityCounterparty;
  /** Up to two token symbols; UNVERIFIED_TOKEN_ICON stands in for an unverified token. */
  icons: string[];
  glyph: ActivityGlyph;
  /** Every movement is an unverified token the wallet did not ask for. */
  spamSuspect: boolean;
  position?: { market?: Market; side?: Side; positionId?: number };
  approval?: { token: string; verified: boolean; unlimited: boolean; revoke: boolean; amount: string | null; exact: string | null };
  bridge?: { from: ActivityChain; to: ActivityChain };
};

export const UNVERIFIED_TOKEN_ICON = '?';
/** Approvals at or above 2^128 base units are effectively unbounded. */
const UNLIMITED_APPROVAL = 1n << 128n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
/** LayerZero EndpointV2 on Ethereum and Base (fx-sdk LZ_ENDPOINT_ADDRESS). */
const LAYERZERO_ENDPOINT = '0x1a44076050125825900e736c501f859c50fe728c';
const LAYERZERO_EIDS: Record<number, ActivityChain> = { 30101: 1, 30184: 8453 };
const TRANSFER_SELECTOR = '0xa9059cbb';
const WRAP_SELECTOR = '0xd0e30db0';
const UNWRAP_SELECTOR = '0x2e1a7d4d';

const lower = (value: string | null | undefined) => value?.toLowerCase() ?? '';
const ROUTER = lower(FX_ROUTER_ADDRESS);
const MINT_ROUTER = lower(FX_MINT_ROUTER_ADDRESS);
const FXSAVE_VAULT = lower(FX_TOKENS.fxSAVE.address);
const WETH = lower(FX_TOKENS.WETH.address);
const ROUTER_SELECTORS: Record<string, { kind: ActionKind; side?: Side }> = {
  '0xef9e1aa7': { kind: 'open', side: 'long' },
  '0xe8e9fc2a': { kind: 'reduce', side: 'long' },
  '0x99414c10': { kind: 'open', side: 'short' },
  '0xad0acfdc': { kind: 'reduce', side: 'short' },
  '0x3ea34dc0': { kind: 'deposit' },
  '0x6d701088': { kind: 'withdraw' },
};
const MINT_ROUTER_SELECTORS: Record<string, ActionKind> = { '0x216d5108': 'borrow', '0x0d8aea82': 'repay', '0xbf4e5936': 'repay' };
const FXSAVE_SELECTORS: Record<string, ActionKind> = { '0x6e553f65': 'deposit', '0xba087652': 'withdraw', '0xaa2f892d': 'queueWithdrawal', '0x1e83409a': 'claim' };
const INTENT_KINDS: Record<string, ActionKind> = {
  'Open position': 'open', 'Increase position': 'increase', 'Reduce position': 'reduce', 'Close position': 'close',
  'Adjust leverage': 'adjust', Borrow: 'borrow', 'Add collateral': 'addCollateral', Repay: 'repay',
  'Withdraw collateral': 'withdrawCollateral', 'Repay and withdraw': 'repay', Deposit: 'deposit', Withdraw: 'withdraw',
  'Queue withdrawal': 'queueWithdrawal', Claim: 'claim', Bridge: 'bridgeOut', Send: 'send',
};
const OPERATION_KINDS: Record<string, ActionKind> = {
  increasePosition: 'open', reducePosition: 'reduce', adjustPositionLeverage: 'adjust', depositAndMint: 'borrow',
  repayAndWithdraw: 'repay', depositFxSave: 'deposit', withdrawFxSave: 'withdraw', getRedeemTx: 'claim',
  buildBridgeTx: 'bridgeOut', sendAsset: 'send',
};
const POSITION_KINDS = new Set<ActivityKind>(['open', 'increase', 'reduce', 'close', 'adjust']);

const POOLS = new Map<string, { market: Market; side: Side }>((['ETH', 'BTC'] as const).flatMap((market) =>
  (['long', 'short'] as const).map((side) => [lower(positionPoolAddress(market, side)), { market, side }] as const)));
const BRIDGE_TOKENS = ['fxUSD', 'fxSAVE'] as const;
/** OFT send destinations: the Ethereum adapters and the Base tokens themselves. */
const OFTS: Record<ActivityChain, Map<string, 'fxUSD' | 'fxSAVE'>> = {
  1: new Map(BRIDGE_TOKENS.map((token) => [lower(canonicalBridgeTarget(token, 1)), token])),
  8453: new Map(BRIDGE_TOKENS.map((token) => [lower(canonicalBridgeTarget(token, 8453)), token])),
};
const ETHEREUM_TOKENS = new Map(Object.values(FX_TOKENS).filter((token) => !token.native).map((token) => [lower(token.address), token.key as string]));

export function networkName(chainId: ActivityChain): string {
  return chainId === 1 ? 'Ethereum' : 'Base';
}

/** Canonical FxAeon token at an address on one chain, or null. */
export function canonicalTokenSymbol(chainId: ActivityChain, address: string | null | undefined): string | null {
  if (!address) return null;
  return chainId === 1 ? ETHEREUM_TOKENS.get(lower(address)) ?? null : OFTS[8453].get(lower(address)) ?? null;
}

/** Canonical symbol and decimals at an address, or null for anything unverified. */
export function canonicalToken(chainId: ActivityChain, address: string | null | undefined): { symbol: string; decimals: number } | null {
  const symbol = canonicalTokenSymbol(chainId, address);
  if (!symbol) return null;
  return { symbol, decimals: chainId === 1 ? FX_TOKENS[symbol as keyof typeof FX_TOKENS].decimals : 18 };
}

/** f(x) position pool behind an address (the position NFT contract). */
export function positionPool(address: string | null | undefined): { market: Market; side: Side } | null {
  return address ? POOLS.get(lower(address)) ?? null : null;
}

/** Display amount: grouped, five significant digits, truncated toward zero, "<0.000001" for dust. */
export function formatActivityAmount(amountRaw: bigint, decimals: number | null): string | null {
  if (decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 77) return null;
  return formatSignificantDecimal(formatUnits(amountRaw < 0n ? -amountRaw : amountRaw, decimals));
}

function exactAmount(amountRaw: bigint, decimals: number | null): string | null {
  if (decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 77) return null;
  return formatUnits(amountRaw < 0n ? -amountRaw : amountRaw, decimals);
}

/** Known contract names; anything else is its short checksummed address. */
export function counterpartyLabel(chainId: ActivityChain, rawAddress: string, context?: ActivityKind): ActivityCounterparty {
  const value = lower(rawAddress);
  const address = isAddress(rawAddress, { strict: false }) ? getAddress(rawAddress) : rawAddress as Address;
  const known = (label: string): ActivityCounterparty => ({ label, address, known: true });
  // On Base the OFT is the token contract itself, so it is the bridge only in a bridge context.
  if (value === LAYERZERO_ENDPOINT || (OFTS[chainId].has(value) && (chainId === 1 || context === 'bridgeOut' || context === 'bridgeIn'))) return known('LayerZero bridge');
  if ((context === 'bridgeIn' || context === 'bridgeOut') && value === ZERO_ADDRESS) return known('LayerZero bridge');
  if (chainId === 1) {
    if (value === ROUTER) return known('f(x) Router');
    if (value === MINT_ROUTER) return known('f(x) Mint Router');
    if (value === FXSAVE_VAULT) return known('fxSAVE vault');
    if (value === WETH) return known('WETH');
  }
  return { label: compactAddress(address), address, known: false };
}

/** Sum every movement per token. The same token in and out nets out; gas is never a transfer. */
export function netActivityFlows(transfers: readonly ActivityTransferInput[]): { flowsIn: ActivityFlow[]; flowsOut: ActivityFlow[] } {
  const totals = new Map<string, { transfer: ActivityTransferInput; net: bigint; inParties: Set<string>; outParties: Set<string> }>();
  for (const transfer of transfers) {
    if (transfer.amountRaw <= 0n) continue;
    const key = transfer.token ? lower(transfer.token) : 'native';
    const entry = totals.get(key) ?? { transfer, net: 0n, inParties: new Set<string>(), outParties: new Set<string>() };
    entry.net += transfer.direction === 'in' ? transfer.amountRaw : -transfer.amountRaw;
    (transfer.direction === 'in' ? entry.inParties : entry.outParties).add(transfer.counterparty);
    // A verified movement of the same contract never inherits an unverified label.
    if (transfer.verified && !entry.transfer.verified) entry.transfer = transfer;
    totals.set(key, entry);
  }
  const flowsIn: ActivityFlow[] = [];
  const flowsOut: ActivityFlow[] = [];
  for (const { transfer, net, inParties, outParties } of totals.values()) {
    if (net === 0n) continue;
    const amountRaw = net < 0n ? -net : net;
    const flow: ActivityFlow = {
      token: transfer.token, symbol: transfer.symbol, decimals: transfer.decimals, verified: transfer.verified, amountRaw,
      amount: formatActivityAmount(amountRaw, transfer.decimals), exact: exactAmount(amountRaw, transfer.decimals),
      counterparties: [...(net > 0n ? inParties : outParties)] as Address[],
    };
    (net > 0n ? flowsIn : flowsOut).push(flow);
  }
  const order = (left: ActivityFlow, right: ActivityFlow) => Number(right.verified) - Number(left.verified);
  return { flowsIn: flowsIn.sort(order), flowsOut: flowsOut.sort(order) };
}

/** "0.5 wstETH", or "12 XYZ (unverified)" so an unverified symbol never stands alone. */
export function flowPhrase(flow: ActivityFlow): string {
  const amount = flow.amount ? `${flow.amount} ` : '';
  return flow.verified ? `${amount}${flow.symbol}` : `${amount}${flow.symbol} (unverified)`;
}

function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const phrases = (flows: readonly ActivityFlow[]) => joinWords(flows.map(flowPhrase));

/** Title symbols: verified symbols, unverified tokens grouped, capped at two then "+ N more". */
function symbolList(flows: readonly ActivityFlow[]): string {
  const verified = [...new Set(flows.filter((flow) => flow.verified).map((flow) => flow.symbol))];
  const unverified = flows.filter((flow) => !flow.verified).length;
  const names = [...verified, ...(unverified === 1 ? ['unverified token'] : unverified > 1 ? [`${unverified} unverified tokens`] : [])];
  if (names.length <= 2) return names.join(' + ');
  return `${names.slice(0, 2).join(' + ')} + ${names.length - 2} more`;
}

const iconFor = (flow: ActivityFlow | undefined) => flow ? flow.verified ? flow.symbol : UNVERIFIED_TOKEN_ICON : undefined;

type Action = {
  kind: ActionKind;
  /** The kind came from the journal's reviewed intent; calldata may not override it. */
  explicit?: boolean;
  position?: { market?: Market; side?: Side; positionId?: number };
  token?: string;
  destination?: ActivityChain;
  approval?: { token: string; verified: boolean; positionApproval?: boolean; spender?: Address; amount?: bigint; decimals: number | null };
  recipient?: Address;
};

function decodedPosition(decoded: DecodedActivityCall | null): Action['position'] | undefined {
  if (decoded?.kind !== 'position') return undefined;
  const pool = positionPool(decoded.pool);
  return { side: decoded.side, ...(pool && pool.side === decoded.side ? { market: pool.market } : {}),
    ...(decoded.positionId > 0n && decoded.positionId <= BigInt(Number.MAX_SAFE_INTEGER) ? { positionId: Number(decoded.positionId) } : {}) };
}

function approvalAction(chainId: ActivityChain, to: string | null | undefined, decoded: DecodedActivityCall | null): Action {
  const pool = positionPool(to);
  const token = canonicalToken(chainId, to);
  const approve = decoded?.kind === 'approve' ? decoded : null;
  return {
    kind: 'approve',
    ...(pool ? { position: { market: pool.market, side: pool.side } } : {}),
    approval: { token: token?.symbol ?? 'token', verified: Boolean(token), positionApproval: Boolean(pool), spender: approve?.spender, amount: approve?.amount, decimals: token?.decimals ?? null },
  };
}

function bridgeTokenFromFlows(flows: readonly ActivityFlow[]): string | undefined {
  return flows.find((flow) => flow.verified && (flow.symbol === 'fxUSD' || flow.symbol === 'fxSAVE'))?.symbol;
}

/** Calldata plus destination; never applied to a transaction someone else sent. */
function selectorAction(chainId: ActivityChain, to: string, selector: string | null, decoded: DecodedActivityCall | null, value: bigint, plainTransfer: boolean): Action | null {
  // Only an indexed call proves an empty input; a journal entry may simply lack its calldata.
  if (!selector) return plainTransfer && value > 0n ? { kind: 'send', token: 'ETH', recipient: to as Address } : null;
  if (chainId === 1 && to === ROUTER && ROUTER_SELECTORS[selector]) {
    const { kind, side } = ROUTER_SELECTORS[selector];
    if (!side) return { kind };
    const position = decodedPosition(decoded) ?? { side };
    if (decoded?.kind === 'position') {
      if (kind === 'open') return { kind: decoded.positionId === 0n ? 'open' : 'increase', position };
      return { kind: decoded.fullClose ? 'close' : 'reduce', position };
    }
    return { kind, position };
  }
  if (chainId === 1 && to === MINT_ROUTER && MINT_ROUTER_SELECTORS[selector]) {
    const pool = decoded && 'pool' in decoded ? positionPool(decoded.pool) : null;
    const position = pool ? { market: pool.market, side: pool.side } : undefined;
    if (decoded?.kind === 'borrow') return { kind: decoded.positionId > 0n && decoded.borrowAmount === 0n ? 'addCollateral' : 'borrow', position };
    if (decoded?.kind === 'repay') return { kind: decoded.repayAmount === 0n ? 'withdrawCollateral' : 'repay', position };
    return { kind: MINT_ROUTER_SELECTORS[selector] };
  }
  if (chainId === 1 && to === FXSAVE_VAULT && FXSAVE_SELECTORS[selector]) return { kind: FXSAVE_SELECTORS[selector] };
  if (selector === OFT_SEND && OFTS[chainId].has(to)) {
    const destination = decoded?.kind === 'oftSend' ? LAYERZERO_EIDS[decoded.destinationEid] : undefined;
    return { kind: 'bridgeOut', token: OFTS[chainId].get(to), destination: destination ?? (chainId === 1 ? 8453 : 1) };
  }
  if (chainId === 1 && to === WETH && selector === WRAP_SELECTOR) return { kind: 'wrap' };
  if (chainId === 1 && to === WETH && selector === UNWRAP_SELECTOR) return { kind: 'unwrap' };
  if (selector === APPROVE) return approvalAction(chainId, to, decoded);
  if (selector === TRANSFER_SELECTOR) {
    return { kind: 'send', token: canonicalTokenSymbol(chainId, to) ?? undefined, recipient: decoded?.kind === 'transfer' ? decoded.recipient : undefined };
  }
  return null;
}

function hasBridgeInEvidence(chainId: ActivityChain, flowsIn: readonly ActivityFlow[]): boolean {
  return flowsIn.some((flow) => flow.verified && (flow.symbol === 'fxUSD' || flow.symbol === 'fxSAVE')
    && flow.counterparties.some((party) => chainId === 1 ? OFTS[1].has(lower(party)) : lower(party) === ZERO_ADDRESS));
}

/**
 * Position NFTs from the four f(x) pools: a new position arrives once from the
 * router, while an existing one leaves for the router and comes back.
 */
function nftAction(nfts: readonly ActivityNftInput[] | undefined, flowsIn: readonly ActivityFlow[], flowsOut: readonly ActivityFlow[]): Action | null {
  const movements = (nfts ?? []).filter((nft) => positionPool(nft.pool));
  if (!movements.length) return null;
  const pool = positionPool(movements[0].pool)!;
  const position = { market: pool.market, side: pool.side };
  const incoming = movements.some((nft) => nft.direction === 'in');
  const outgoing = movements.some((nft) => nft.direction === 'out');
  if (incoming && !outgoing) return { kind: 'open', position };
  if (!incoming || !outgoing) return null;
  if (flowsOut.length && !flowsIn.length) return { kind: 'increase', position };
  if (flowsIn.length && !flowsOut.length) return { kind: 'reduce', position };
  return { kind: 'adjust', position };
}

/**
 * The shape of the wallet's net flows. `contractCall` is a wallet-sent call to
 * a function History does not know: paying into it is a contract interaction,
 * not a send to a person.
 */
function flowAction(chainId: ActivityChain, flowsIn: readonly ActivityFlow[], flowsOut: readonly ActivityFlow[], contractCall: boolean): Action {
  if (!flowsIn.length && !flowsOut.length) return { kind: 'contract' };
  if (!flowsOut.length) {
    return hasBridgeInEvidence(chainId, flowsIn) ? { kind: 'bridgeIn', token: bridgeTokenFromFlows(flowsIn) } : { kind: 'receive' };
  }
  if (!flowsIn.length) {
    const parties = new Set(flowsOut.flatMap((flow) => flow.counterparties.map(lower)));
    return parties.size === 1 && !contractCall ? { kind: 'send' } : { kind: 'contract' };
  }
  return { kind: 'swap' };
}

/** Position facts from every source, in order of authority. */
function positionEvidence(action: Action, input: ActivityClassificationInput, decoded: DecodedActivityCall | null): Action['position'] {
  const fromCall = decodedPosition(decoded);
  const indexed = input.protocol?.[0];
  const nftPool = input.nfts?.map((nft) => positionPool(nft.pool)).find(Boolean) ?? null;
  const side = action.position?.side ?? fromCall?.side ?? indexed?.side ?? nftPool?.side;
  const sideMatches = <T extends { side: Side }>(candidate: T | null | undefined): T | null => candidate && (!side || candidate.side === side) ? candidate : null;
  const market = action.position?.market ?? fromCall?.market ?? sideMatches(indexed)?.market ?? sideMatches(nftPool)?.market;
  const positionId = action.position?.positionId ?? fromCall?.positionId ?? indexed?.positionId;
  return { ...(market ? { market } : {}), ...(side ? { side } : {}), ...(positionId ? { positionId } : {}) };
}

/** Open vs. add and reduce vs. close, when the reviewed intent did not already say. */
function refinePositionKind(action: Action, input: ActivityClassificationInput, decoded: DecodedActivityCall | null): ActionKind {
  if (action.explicit) return action.kind;
  if (decoded?.kind === 'position') {
    if (decoded.direction === 'open' && (action.kind === 'open' || action.kind === 'increase')) return decoded.positionId === 0n ? 'open' : 'increase';
    if (decoded.direction === 'close' && (action.kind === 'reduce' || action.kind === 'close')) return decoded.fullClose ? 'close' : 'reduce';
  }
  if (action.kind === 'open' || action.kind === 'increase') {
    // A new position NFT arrives once; an existing one leaves for the router and returns.
    const incoming = input.nfts?.some((nft) => nft.direction === 'in') ?? false;
    const outgoing = input.nfts?.some((nft) => nft.direction === 'out') ?? false;
    if (incoming && outgoing) return 'increase';
    if (incoming) return 'open';
  }
  return action.kind;
}

function positionPhrase(position: Action['position']): string {
  if (position?.market && position.side) return `${position.market} ${position.side}`;
  if (position?.side) return `${position.side} position`;
  return 'position';
}

const withArticle = (phrase: string) => `${/^(?:ETH|[aeiou])/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
const marketIcon = (position: Action['position']) => position?.market === 'BTC' ? 'BTC' : position?.market === 'ETH' ? 'ETH' : undefined;

function glyphFor(kind: ActionKind, position: Action['position']): ActivityGlyph {
  switch (kind) {
    case 'send': return 'send';
    case 'receive': return 'receive';
    case 'swap': case 'wrap': case 'unwrap': return 'swap';
    case 'bridgeOut': case 'bridgeIn': return 'move';
    case 'open': case 'increase': case 'reduce': case 'close': case 'adjust': return position?.side === 'short' ? 'short' : 'long';
    case 'deposit': case 'withdraw': case 'queueWithdrawal': case 'claim': return 'earn';
    case 'borrow': case 'repay': case 'addCollateral': case 'withdrawCollateral': return 'borrow';
    case 'approve': return 'approve';
    default: return 'contract';
  }
}

function sentenceName(counterparty: ActivityCounterparty | undefined): string | null {
  if (!counterparty) return null;
  if (!counterparty.known) return counterparty.label;
  return counterparty.label === 'WETH' ? 'the WETH contract' : `the ${counterparty.label}`;
}

type Context = {
  action: Action;
  kind: ActionKind;
  done: boolean;
  chainId: ActivityChain;
  flowsIn: ActivityFlow[];
  flowsOut: ActivityFlow[];
  counterparty?: ActivityCounterparty;
  call?: ActivityCallInput;
  decoded: DecodedActivityCall | null;
};

function titleFor({ action, kind, done, flowsIn, flowsOut }: Context): string {
  const pick = (past: string, base: string) => done ? past : base;
  const position = positionPhrase(action.position);
  switch (kind) {
    case 'open': return pick(`Opened ${position}`, `Open ${position}`);
    case 'increase': return pick(`Added to ${position}`, `Add to ${position}`);
    case 'reduce': return pick(`Reduced ${position}`, `Reduce ${position}`);
    case 'close': return pick(`Closed ${position}`, `Close ${position}`);
    case 'adjust': return action.position?.market || action.position?.side
      ? pick(`Adjusted ${position} leverage`, `Adjust ${position} leverage`) : pick('Adjusted leverage', 'Adjust leverage');
    case 'deposit': return pick('Deposited to fxSAVE', 'Deposit to fxSAVE');
    case 'withdraw': return pick('Withdrew from fxSAVE', 'Withdraw from fxSAVE');
    case 'queueWithdrawal': return pick('Queued fxSAVE withdrawal', 'Queue fxSAVE withdrawal');
    case 'claim': return pick('Claimed fxSAVE withdrawal', 'Claim fxSAVE withdrawal');
    case 'borrow': return pick('Borrowed fxUSD', 'Borrow fxUSD');
    case 'repay': return pick('Repaid fxUSD', 'Repay fxUSD');
    case 'addCollateral': return pick('Added collateral', 'Add collateral');
    case 'withdrawCollateral': return pick('Withdrew collateral', 'Withdraw collateral');
    case 'bridgeOut': {
      const token = action.token ?? 'funds';
      const destination = networkName(action.destination ?? 8453);
      return pick(`Moved ${token} to ${destination}`, `Move ${token} to ${destination}`);
    }
    case 'bridgeIn': {
      const token = action.token ?? 'funds';
      const network = networkName(action.destination ?? 8453);
      return pick(`Received ${token} on ${network}`, `Receive ${token} on ${network}`);
    }
    case 'approve': {
      const approval = action.approval;
      if (approval?.positionApproval) return pick(`Approved ${position} position`, `Approve ${position} position`);
      const token = approval?.verified ? approval.token : 'token';
      if (approval?.amount === 0n) return pick(`Revoked ${token} approval`, `Revoke ${token} approval`);
      return pick(`Approved ${token}`, `Approve ${token}`);
    }
    case 'swap': {
      const sent = symbolList(flowsOut) || 'tokens';
      const received = symbolList(flowsIn) || 'tokens';
      return pick(`Swapped ${sent} for ${received}`, `Swap ${sent} for ${received}`);
    }
    case 'send': {
      const token = symbolList(flowsOut) || action.token || 'token';
      return pick(`Sent ${token}`, `Send ${token}`);
    }
    case 'receive': {
      const token = symbolList(flowsIn) || action.token || 'token';
      return pick(`Received ${token}`, `Receive ${token}`);
    }
    case 'wrap': return pick('Wrapped ETH', 'Wrap ETH');
    case 'unwrap': return pick('Unwrapped WETH', 'Unwrap WETH');
    default: return 'Contract interaction';
  }
}

function summaryFor(context: Context): string {
  const { action, kind, chainId, flowsIn, flowsOut, counterparty, call, decoded } = context;
  const position = positionPhrase(action.position);
  const name = sentenceName(counterparty);
  const received = flowsIn.length ? ` and received ${phrases(flowsIn)}` : '';
  const isShare = (flow: ActivityFlow) => flow.verified && flow.symbol === 'fxSAVE';
  switch (kind) {
    case 'send': return `You sent ${flowsOut.length ? phrases(flowsOut) : action.token ?? 'tokens'}${name ? ` to ${name}` : ''}.`;
    case 'receive': return `You received ${flowsIn.length ? phrases(flowsIn) : action.token ?? 'tokens'}${name ? ` from ${name}` : ''}.`;
    case 'swap': return `You swapped ${phrases(flowsOut)} for ${phrases(flowsIn)}.`;
    case 'wrap': {
      const eth = flowsOut.find((flow) => flow.token === null);
      const amount = eth?.amount ?? (call?.value ? formatActivityAmount(call.value, 18) : null);
      return amount ? `You wrapped ${amount} ETH into WETH.` : 'You wrapped ETH into WETH.';
    }
    case 'unwrap': {
      const eth = flowsIn.find((flow) => flow.token === null);
      const amount = eth?.amount ?? (decoded?.kind === 'unwrap' ? formatActivityAmount(decoded.amount, 18) : null);
      return amount ? `You unwrapped ${amount} WETH into ETH.` : 'You unwrapped WETH into ETH.';
    }
    case 'open': return `You opened ${withArticle(position)}${flowsOut.length ? ` with ${phrases(flowsOut)}` : ''}${received}.`;
    case 'increase': return flowsOut.length ? `You added ${phrases(flowsOut)} to your ${position}${received}.` : `You added to your ${position}${received}.`;
    case 'reduce': return `You reduced your ${position}${received}.`;
    case 'close': return `You closed your ${position}${received}.`;
    case 'adjust': return `You adjusted the leverage on your ${position}${flowsOut.length ? `, adding ${phrases(flowsOut)}` : ''}${received}.`;
    case 'deposit': {
      const paid = flowsOut.filter((flow) => !isShare(flow));
      const shares = flowsIn.filter(isShare);
      return paid.length
        ? `You deposited ${phrases(paid)} into fxSAVE${shares.length ? ` and received ${phrases(shares)}` : ''}.`
        : 'You deposited into fxSAVE.';
    }
    case 'withdraw': {
      const shares = flowsOut.filter(isShare);
      const proceeds = flowsIn.filter((flow) => !isShare(flow));
      if (proceeds.length) return `You withdrew ${phrases(proceeds)} from fxSAVE${shares.length ? ` by redeeming ${phrases(shares)}` : ''}.`;
      return shares.length ? `You redeemed ${phrases(shares)} from fxSAVE.` : 'You withdrew from fxSAVE.';
    }
    case 'queueWithdrawal': return flowsOut.length ? `You queued ${phrases(flowsOut)} for withdrawal.` : 'You queued an fxSAVE withdrawal.';
    case 'claim': return flowsIn.length ? `You claimed ${phrases(flowsIn)} from your fxSAVE withdrawal.` : 'You claimed your fxSAVE withdrawal.';
    case 'borrow': {
      const debt = flowsIn.filter((flow) => flow.verified && flow.symbol === 'fxUSD');
      return debt.length ? `You borrowed ${phrases(debt)}${flowsOut.length ? ` against ${phrases(flowsOut)}` : ''}.` : 'You borrowed fxUSD.';
    }
    case 'repay': {
      const repaid = flowsOut.filter((flow) => flow.verified && flow.symbol === 'fxUSD');
      const withdrawn = flowsIn.filter((flow) => !(flow.verified && flow.symbol === 'fxUSD'));
      return `You repaid ${repaid.length ? phrases(repaid) : 'fxUSD'}${withdrawn.length ? ` and withdrew ${phrases(withdrawn)}` : ''}.`;
    }
    case 'addCollateral': {
      const debt = flowsIn.filter((flow) => flow.verified && flow.symbol === 'fxUSD');
      return flowsOut.length ? `You added ${phrases(flowsOut)} as collateral${debt.length ? ` and borrowed ${phrases(debt)}` : ''}.` : 'You added collateral.';
    }
    case 'withdrawCollateral': return flowsIn.length ? `You withdrew ${phrases(flowsIn)} of collateral.` : 'You withdrew collateral.';
    case 'bridgeOut': {
      const moved = flowsOut.filter((flow) => flow.token !== null);
      const fee = flowsOut.filter((flow) => flow.token === null);
      const route = `from ${networkName(chainId)} to ${networkName(action.destination ?? (chainId === 1 ? 8453 : 1))}`;
      return `You moved ${moved.length ? phrases(moved) : action.token ?? 'funds'} ${route}${fee.length ? ` and paid ${phrases(fee)} in bridge fees` : ''}.`;
    }
    case 'bridgeIn': return `You received ${flowsIn.length ? phrases(flowsIn) : action.token ?? 'funds'} on ${networkName(chainId)} from ${networkName(chainId === 1 ? 8453 : 1)}.`;
    case 'approve': {
      const approval = action.approval;
      const spender = name ?? 'a contract';
      if (approval?.positionApproval) return `You allowed ${spender} to manage your ${position} position.`;
      const token = approval?.verified ? approval.token : 'token';
      if (approval?.amount === undefined) return `You allowed ${spender} to spend your ${token}.`;
      if (approval.amount === 0n) return `You removed ${spender}'s permission to spend your ${token}.`;
      if (approval.amount >= UNLIMITED_APPROVAL) return `You allowed ${spender} to spend unlimited ${token}.`;
      const amount = formatActivityAmount(approval.amount, approval.decimals);
      return amount ? `You allowed ${spender} to spend up to ${amount} ${token}.` : `You allowed ${spender} to spend your ${token}.`;
    }
    default: {
      const parts = [flowsOut.length ? `sent ${phrases(flowsOut)}` : '', flowsIn.length ? `received ${phrases(flowsIn)}` : ''].filter(Boolean);
      if (!parts.length) return `You interacted with ${name ?? 'a contract'}. No tokens moved.`;
      return `You ${parts.join(' and ')} in a contract interaction${name ? ` with ${name}` : ''}.`;
    }
  }
}

function iconsFor({ action, kind, flowsIn, flowsOut }: Context): string[] {
  const firstIn = iconFor(flowsIn[0]);
  const firstOut = iconFor(flowsOut[0]);
  const market = marketIcon(action.position);
  let icons: (string | undefined)[];
  switch (kind) {
    case 'send': case 'queueWithdrawal': case 'addCollateral': icons = [firstOut ?? action.token ?? (kind === 'queueWithdrawal' ? 'fxSAVE' : undefined)]; break;
    case 'receive': case 'withdrawCollateral': icons = [firstIn ?? action.token]; break;
    case 'swap': icons = [firstOut, firstIn]; break;
    case 'open': case 'increase': case 'adjust': icons = [firstOut ?? market, market]; break;
    case 'reduce': case 'close': icons = [market, firstIn]; break;
    case 'deposit': icons = [iconFor(flowsOut.find((flow) => flow.symbol !== 'fxSAVE')), 'fxSAVE']; break;
    case 'withdraw': case 'claim': icons = ['fxSAVE', iconFor(flowsIn.find((flow) => flow.symbol !== 'fxSAVE'))]; break;
    case 'borrow': icons = [firstOut, 'fxUSD']; break;
    case 'repay': icons = ['fxUSD']; break;
    case 'bridgeOut': case 'bridgeIn': icons = [action.token ?? firstOut ?? firstIn]; break;
    case 'approve': icons = [action.approval?.positionApproval ? market : action.approval?.verified ? action.approval.token : UNVERIFIED_TOKEN_ICON]; break;
    case 'wrap': icons = ['ETH', 'WETH']; break;
    case 'unwrap': icons = ['WETH', 'ETH']; break;
    default: icons = [firstOut ?? firstIn];
  }
  return [...new Set(icons.filter((icon): icon is string => Boolean(icon)))].slice(0, 2);
}

function counterpartyFor(chainId: ActivityChain, kind: ActionKind, action: Action, flowsIn: readonly ActivityFlow[], flowsOut: readonly ActivityFlow[], destination: string | null, walletInitiated: boolean | null): ActivityCounterparty | undefined {
  const only = (flows: readonly ActivityFlow[]) => {
    const parties = new Map(flows.flatMap((flow) => flow.counterparties.map((party) => [lower(party), party] as const)));
    return parties.size === 1 ? [...parties.values()][0] : undefined;
  };
  let address: string | undefined;
  switch (kind) {
    case 'approve': address = action.approval?.spender; break;
    case 'send': address = action.recipient ?? only(flowsOut) ?? (destination && !canonicalTokenSymbol(chainId, destination) ? destination : undefined); break;
    case 'receive': case 'bridgeIn': address = only(flowsIn); break;
    case 'swap': case 'contract': address = (walletInitiated ? destination : undefined) ?? only(flowsOut) ?? only(flowsIn) ?? destination ?? undefined; break;
    default: address = destination ?? only(flowsOut) ?? only(flowsIn);
  }
  return address ? counterpartyLabel(chainId, address, kind) : undefined;
}

export type ActivityLeg = { flow: ActivityFlow; direction: 'in' | 'out' };
/** Kinds whose headline is what arrived; the rest lead with what left. */
const INCOMING_FIRST = new Set<ActivityKind>(['receive', 'swap', 'wrap', 'unwrap', 'reduce', 'close', 'adjust', 'withdraw', 'claim', 'borrow', 'withdrawCollateral', 'bridgeIn', 'contract']);

/** The row's headline movement and every other leg, in reading order. */
export function activityLegs(classification: Pick<ActivityClassification, 'kind' | 'attempted' | 'flowsIn' | 'flowsOut'>): { primary?: ActivityLeg; others: ActivityLeg[] } {
  const kind = classification.kind === 'failed' ? classification.attempted ?? 'contract' : classification.kind;
  const incoming = classification.flowsIn.map((flow): ActivityLeg => ({ flow, direction: 'in' }));
  const outgoing = classification.flowsOut.map((flow): ActivityLeg => ({ flow, direction: 'out' }));
  const ordered = INCOMING_FIRST.has(kind) ? [...incoming, ...outgoing] : [...outgoing, ...incoming];
  // A bridge's native ETH is its fee; the moved token is the headline.
  const primary = (kind === 'bridgeOut' ? ordered.find((leg) => leg.flow.verified && leg.flow.token !== null) : undefined)
    ?? ordered.find((leg) => leg.flow.verified) ?? ordered[0];
  return { ...(primary ? { primary } : {}), others: ordered.filter((leg) => leg !== primary) };
}

/** Signed display amount with a true minus sign, e.g. "−0.5 wstETH" or "+12 XYZ". */
export function signedLegText(leg: ActivityLeg): string {
  const sign = leg.direction === 'in' ? '+' : '−';
  return `${sign}${leg.flow.amount ?? '?'} ${leg.flow.symbol}`;
}

/**
 * Explain one transaction. Precedence: journal intent, then the protocol index,
 * then calldata with its destination, then the shape of the wallet's net flows.
 */
export function classifyActivity(input: ActivityClassificationInput): ActivityClassification {
  const wallet = lower(input.wallet);
  const { flowsIn, flowsOut } = netActivityFlows(input.transfers);
  const call = input.call;
  const decoded = decodeActivityCall(call?.input);
  const selector = callSelector(call?.input) ?? (call?.selector && /^0x[0-9a-f]{8}$/i.test(call.selector) ? call.selector.toLowerCase() : null);
  const destination = lower(call?.to ?? input.journal?.to) || null;
  // The journal only records this wallet's own signatures.
  const walletInitiated = input.journal ? true : call?.from ? lower(call.from) === wallet : null;
  const journal = input.journal;

  let action: Action | null = null;
  if (journal?.stepKind === 'approval') action = approvalAction(input.chainId, journal.to ?? call?.to, decoded);
  if (!action && journal?.bridge) action = { kind: 'bridgeOut', explicit: true };
  if (!action && journal?.intent && INTENT_KINDS[journal.intent]) action = { kind: INTENT_KINDS[journal.intent], explicit: true };
  if (!action && input.protocol?.length) {
    const [indexed] = input.protocol;
    // The index tells a final close from a reduction; its "Open" also covers additions.
    action = { kind: indexed.kind, explicit: indexed.kind !== 'open',
      position: { market: indexed.market, side: indexed.side, ...(indexed.positionId ? { positionId: indexed.positionId } : {}) } };
  }
  if (!action && walletInitiated !== false && destination) {
    action = selectorAction(input.chainId, destination, selector, decoded, call?.value ?? 0n, !journal && typeof call?.input === 'string');
  }
  if (!action && journal?.operation && OPERATION_KINDS[journal.operation]) action = { kind: OPERATION_KINDS[journal.operation] };
  if (!action) action = nftAction(input.nfts, flowsIn, flowsOut) ?? flowAction(input.chainId, flowsIn, flowsOut, walletInitiated === true && selector !== null);

  let kind = action.kind;
  if (POSITION_KINDS.has(kind)) {
    action.position = positionEvidence(action, input, decoded);
    kind = refinePositionKind(action, input, decoded);
  } else if (kind === 'borrow' || kind === 'repay' || kind === 'addCollateral' || kind === 'withdrawCollateral') {
    if (decoded?.kind === 'borrow' && !action.explicit) kind = decoded.positionId > 0n && decoded.borrowAmount === 0n ? 'addCollateral' : 'borrow';
    if (decoded?.kind === 'repay' && !action.explicit) kind = decoded.repayAmount === 0n ? 'withdrawCollateral' : 'repay';
  } else if (kind === 'bridgeOut') {
    const oftToken = destination ? OFTS[input.chainId].get(destination) : undefined;
    const decodedDestination = decoded?.kind === 'oftSend' ? LAYERZERO_EIDS[decoded.destinationEid] : undefined;
    const journalDestination = journal?.bridge?.destinationChainId === 1 || journal?.bridge?.destinationChainId === 8453 ? journal.bridge.destinationChainId : undefined;
    const journalToken = journal?.bridge?.bridgeToken === 'fxUSD' || journal?.bridge?.bridgeToken === 'fxSAVE' ? journal.bridge.bridgeToken : undefined;
    action.token ??= journalToken ?? oftToken ?? bridgeTokenFromFlows(flowsOut);
    action.destination ??= journalDestination ?? decodedDestination ?? (input.chainId === 1 ? 8453 : 1);
  } else if (kind === 'bridgeIn') {
    action.token ??= bridgeTokenFromFlows(flowsIn);
    action.destination = input.chainId;
  } else if (kind === 'send' && !action.token && journal && !flowsOut.length) {
    action.token = canonicalTokenSymbol(input.chainId, journal.to) ?? (call?.value ? 'ETH' : undefined);
  }

  const done = input.status === 'confirmed' || input.status === 'indexed';
  const failed = input.status === 'failed';
  // A reverted transaction moved nothing; any indexed movement is not shown as its outcome.
  const shownIn = failed ? [] : flowsIn;
  const shownOut = failed ? [] : flowsOut;
  const counterparty = counterpartyFor(input.chainId, kind, action, shownIn, shownOut, destination, walletInitiated);
  const context: Context = { action, kind, done, chainId: input.chainId, flowsIn: shownIn, flowsOut: shownOut, counterparty, call, decoded };
  const network = networkName(input.chainId);
  const spamSuspect = !journal && !input.protocol?.length && input.transfers.length > 0
    && input.transfers.every((transfer) => !transfer.verified) && walletInitiated !== true;
  const approval = action.approval && !action.approval.positionApproval ? {
    token: action.approval.token,
    verified: action.approval.verified,
    unlimited: action.approval.amount !== undefined && action.approval.amount >= UNLIMITED_APPROVAL,
    revoke: action.approval.amount === 0n,
    amount: action.approval.amount !== undefined && action.approval.amount < UNLIMITED_APPROVAL ? formatActivityAmount(action.approval.amount, action.approval.decimals) : null,
    exact: action.approval.amount !== undefined && action.approval.amount < UNLIMITED_APPROVAL ? exactAmount(action.approval.amount, action.approval.decimals) : null,
  } : undefined;
  return {
    kind: failed ? 'failed' : kind,
    ...(failed ? { attempted: kind } : {}),
    title: titleFor(context),
    summary: failed
      ? `This transaction failed on ${network}. Nothing moved except the network fee.`
      : input.status === 'pending' ? `Waiting for confirmation on ${network}.` : summaryFor(context),
    flowsIn: shownIn,
    flowsOut: shownOut,
    ...(counterparty ? { counterparty } : {}),
    icons: iconsFor(context),
    glyph: glyphFor(kind, action.position),
    spamSuspect,
    ...(POSITION_KINDS.has(kind) || action.approval?.positionApproval ? { position: action.position ?? {} } : {}),
    ...(approval ? { approval } : {}),
    ...(kind === 'bridgeOut' ? { bridge: { from: input.chainId, to: action.destination ?? (input.chainId === 1 ? 8453 : 1) } } : {}),
    ...(kind === 'bridgeIn' ? { bridge: { from: input.chainId === 1 ? 8453 : 1, to: input.chainId } } : {}),
  };
}
