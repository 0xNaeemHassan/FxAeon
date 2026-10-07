import { formatUnits } from 'viem';
import { FX_TOKENS, formatRouteGasCost, type PlannedRoute } from '@/lib/fx';
import { compactAddress } from '@/lib/addressPresentation';
import { routeFinancialReviewFacts, type ReviewFact } from '@/lib/fx/reviewFormatting';
import type { UseGasCostResult } from '@/lib/fx/useGasCost';
import { networkFeeWei } from '@/lib/fx/gasCost';
import { formatGasTierQuote, type GasTierQuote } from '@/lib/fx/gasFeePolicy';

export interface ExecutionCost { estimatedGas?: string; gasFee?: string; protocolFee?: string; totalCost?: string }
type BridgeReviewQuote = { nativeFee: bigint; destinationChainId?: number; bridgeToken?: string; bridgeAmount?: bigint; minAmountLD?: bigint; recipient?: string };
function isBridgeQuote(value: unknown): value is BridgeReviewQuote {
  return Boolean(value && typeof value === 'object' && 'nativeFee' in value && typeof (value as { nativeFee?: unknown }).nativeFee === 'bigint');
}

function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : value;
}

function tokenForAddress(address: string | undefined) {
  if (!address) return undefined;
  return Object.values(FX_TOKENS).find((token) => token.address.toLowerCase() === address.toLowerCase());
}

function conciseDecimal(value: string, places = 6): string {
  const [whole, fraction = ''] = value.split('.');
  const shown = fraction.slice(0, places).replace(/0+$/, '');
  const omitted = /[1-9]/.test(fraction.slice(places));
  if (omitted && whole === '0' && !shown) return `<0.${'0'.repeat(Math.max(places - 1, 0))}1`;
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${omitted ? '≈ ' : ''}${groupedWhole}${shown ? `.${shown}` : ''}`;
}

function addTokenAmountFact(facts: ReviewFact[], label: string, value: bigint, tokenAddress?: string, fallback = 'raw units'): void {
  const token = tokenForAddress(tokenAddress);
  if (!token) {
    addFact(facts, label, `${value.toString()} ${fallback}`);
    return;
  }
  const exact = trimDecimal(formatUnits(value, token.decimals));
  facts.push({ label, value: `${conciseDecimal(exact)} ${token.key}`, title: `${exact} ${token.key}` });
}

function addWadAmountFact(facts: ReviewFact[], label: string, value: bigint, unit: string): void {
  const exact = trimDecimal(formatUnits(value, 18));
  facts.push({ label, value: `${conciseDecimal(exact)} ${unit}`, title: `${exact} ${unit}` });
}

function addFact(facts: ReviewFact[], label: string, value: string | undefined): void {
  if (!value || facts.some((fact) => fact.label === label)) return;
  facts.push({ label, value });
}

function bridgeChainName(chainId: number | undefined): string | undefined {
  if (chainId === 1) return 'Ethereum';
  if (chainId === 8453) return 'Base';
  return undefined;
}

function addNativeCostFact(facts: ReviewFact[], label: string, exactValue: string | undefined): void {
  if (!exactValue || facts.some((fact) => fact.label === label)) return;
  const match = exactValue.match(/^(\d[\d,]*(?:\.\d+)?)\s+(ETH|Gwei)(.*)$/);
  if (!match) {
    addFact(facts, label, exactValue);
    return;
  }
  const [, amount, unit, qualifier] = match;
  const isMax = /\bmax\b/i.test(qualifier);
  const shortQualifier = isMax ? ' max' : label === 'Total cost' ? ' total' : '';
  facts.push({
    label,
    value: `${conciseDecimal(amount, 6)} ${unit}${shortQualifier}`,
    title: exactValue,
  });
}

export function primaryReviewFacts(route: PlannedRoute): ReviewFact[] {
  const facts: ReviewFact[] = [];
  const intent = route.policy?.reviewedAction;
  if (intent) {
    switch (intent.kind) {
      case 'position-increase':
        addTokenAmountFact(facts, 'Amount', intent.inputAmount, intent.inputTokenAddress);
        if (intent.requestedLeverage !== undefined) addFact(facts, 'Target leverage', `${intent.requestedLeverage}×`);
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        addFact(facts, 'Position', intent.positionId === 0 ? 'New position' : `#${intent.positionId}`);
        break;
      case 'position-reduce':
        addFact(facts, 'Position', `#${intent.positionId}`);
        addFact(facts, 'Action', intent.isClosePosition ? 'Close position' : 'Reduce position');
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'position-adjust':
        addFact(facts, 'Position', `#${intent.positionId}`);
        if (intent.requestedLeverage !== undefined) addFact(facts, 'Target leverage', `${intent.requestedLeverage}×`);
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'deposit-and-mint':
        addTokenAmountFact(facts, 'Deposit', intent.depositAmount, intent.depositTokenAddress);
        addTokenAmountFact(facts, 'Borrow', intent.mintAmount, FX_TOKENS.fxUSD.address);
        addFact(facts, 'Position', intent.positionId === 0 ? 'New position' : `#${intent.positionId}`);
        break;
      case 'repay-and-withdraw':
        addTokenAmountFact(facts, 'Repay', intent.minimumRepayAmount, intent.repayTokenAddress);
        addTokenAmountFact(facts, 'Withdraw', intent.withdrawAmount, intent.withdrawTokenAddress);
        addFact(facts, 'Position', `#${intent.positionId}`);
        break;
      case 'fxsave-deposit':
        addTokenAmountFact(facts, 'Deposit', intent.amount, intent.tokenInAddress);
        addFact(facts, 'Recipient', compactAddress(intent.receiver));
        if (!intent.directBasePool) addFact(facts, 'Final fxSAVE minimum', 'Not enforced by this route');
        break;
      case 'fxsave-withdraw':
        addTokenAmountFact(facts, 'fxSAVE', intent.amount, FX_TOKENS.fxSAVE.address);
        addFact(facts, 'Receive', tokenForAddress(intent.tokenOutAddress)?.key ?? compactAddress(intent.tokenOutAddress));
        addFact(facts, 'Mode', intent.directBasePool ? 'Direct' : intent.instant ? 'Instant' : 'Queued');
        if (intent.slippagePercent !== undefined) addFact(facts, 'Slippage', `${intent.slippagePercent}%`);
        break;
      case 'fxsave-claim':
        addFact(facts, 'Recipient', compactAddress(intent.receiver));
        break;
    }
  }

  if (route.details?.routeType) addFact(facts, 'Route', route.details.routeType);
  if (route.details?.requestedLeverage !== undefined) addFact(facts, 'Target leverage', `${route.details.requestedLeverage}×`);
  if (route.details?.slippagePercent !== undefined) addFact(facts, 'Slippage', `${route.details.slippagePercent}%`);
  if (route.details?.leverage !== undefined) facts.push({
    label: 'Leverage',
    value: `${conciseDecimal(String(route.details.leverage), 2)}×`,
    title: `${route.details.leverage}×`,
  });
  facts.push(...routeFinancialReviewFacts(route));

  if (isBridgeQuote(route.quote)) {
    addFact(facts, 'Source network', bridgeChainName(route.chainId));
    addFact(facts, 'Destination network', bridgeChainName(route.quote.destinationChainId));
    addFact(facts, 'Asset', route.quote.bridgeToken ?? 'Bridge asset');
    if (route.quote.bridgeAmount !== undefined) {
      addWadAmountFact(facts, 'Amount', route.quote.bridgeAmount, route.quote.bridgeToken ?? 'tokens');
    }
    if (route.quote.minAmountLD !== undefined) {
      addWadAmountFact(facts, 'Minimum received', route.quote.minAmountLD, route.quote.bridgeToken ?? 'tokens');
    }
    if (route.quote.recipient) addFact(facts, 'Recipient', route.quote.recipient);
    addWadAmountFact(facts, 'Bridge fee', route.quote.nativeFee, 'ETH');
  }

  return facts;
}

/** Keep each user consequence in its dedicated summary exactly once. */
export function factsOutsideConsequenceSummary(summaryFacts: readonly ReviewFact[], consequenceFacts: readonly ReviewFact[]): ReviewFact[] {
  const owned = new Set(consequenceFacts.map((fact) => `${fact.label}\u0000${fact.value}`));
  return summaryFacts.filter((fact) => !owned.has(`${fact.label}\u0000${fact.value}`));
}

export function routeFacts(route: PlannedRoute, gasCost: Pick<UseGasCostResult, 'estimate' | 'estimateIsCurrent'>, executionCost?: ExecutionCost, feeTierQuote?: GasTierQuote): ReviewFact[] {
  const facts = primaryReviewFacts(route);
  if (feeTierQuote) addFact(facts, 'Gas tier', formatGasTierQuote(feeTierQuote));
  const currentEstimate = gasCost.estimateIsCurrent ? gasCost.estimate : undefined;
  const currentGasCost = gasCost.estimateIsCurrent && gasCost.estimate
    ? formatRouteGasCost(gasCost.estimate)
    : undefined;
  if (currentGasCost?.gasFee) addNativeCostFact(facts, 'Gas fee', currentGasCost.gasFee);
  const totalIsOnlyTheGasFee = currentEstimate?.nativeValueWei === 0n
    && currentEstimate.totalNativeCostWei !== undefined
    && currentEstimate.totalNativeCostWei === networkFeeWei(currentEstimate);
  if (currentGasCost?.totalCost && !totalIsOnlyTheGasFee) addNativeCostFact(facts, 'Total cost', currentGasCost.totalCost);
  if (executionCost?.gasFee) addNativeCostFact(facts, 'Gas fee', executionCost.gasFee);
  if (executionCost?.protocolFee) addFact(facts, 'Protocol fee', executionCost.protocolFee);
  if (executionCost?.totalCost) addNativeCostFact(facts, 'Total cost', executionCost.totalCost);
  return facts;
}

/** Keep the gas row present while its optional estimate settles. */
export function missingGasFeeFact(gasCost: Pick<UseGasCostResult, 'estimate' | 'estimateIsCurrent' | 'status' | 'error'>): ReviewFact | undefined {
  if (gasCost.estimateIsCurrent && gasCost.estimate?.status === 'current') return undefined;
  if (gasCost.status === 'refreshing') {
    return { label: 'Gas fee', value: '—' };
  }
  return {
    label: 'Gas fee',
    value: gasCost.estimate?.status === 'partial'
      ? 'Partial estimate'
      : 'Unavailable',
  };
}

/** Reserve a total-cost row only when the reviewed transactions send native value. */
export function missingTotalCostFact(
  route: PlannedRoute,
  gasCost: Pick<UseGasCostResult, 'estimateIsCurrent' | 'status'>,
): ReviewFact | undefined {
  if (!route.transactions.some((transaction) => transaction.value > 0n)) return undefined;
  if (gasCost.status === 'refreshing' && !gasCost.estimateIsCurrent) {
    return { label: 'Total cost', value: '—' };
  }
  return { label: 'Total cost', value: 'Unavailable' };
}
