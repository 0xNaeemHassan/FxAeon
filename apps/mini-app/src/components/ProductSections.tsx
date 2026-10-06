'use client';

import { ArrowLeftRight, BadgeCheck, CircleDollarSign, Clock3, Coins, Gauge, Layers2, PiggyBank, Route, ShieldAlert, Signature, TrendingUp, Wallet } from 'lucide-react';
import { useLiveMarketQuote } from '@/components/PriceProvider';
import { useMarketHistory } from '@/components/MarketChart';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { formatUsdPrice } from '@/lib/prices';
import type { MarketSymbol } from '@/lib/marketData';
import { Callout, PageSections, Questions, Section, StatGrid, Steps } from '@/components/PageSections';

// Reviewed f(x) Protocol references, the same ones the landing page links.
const FX_REBALANCING_DOCS = 'https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake';
const FX_BORROWING_DOCS = 'https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fxmint-borrowing-fxusd-against-your-btc-and-eth';

const rebalancingNote = <Callout icon={ShieldAlert} title="A brake before liquidation" link={{ label: 'How rebalancing works', href: FX_REBALANCING_DOCS }}>
  Automatic rebalancing can reduce leverage at protocol thresholds. Liquidation remains possible, so keep room between your position and the limits.
</Callout>;

/** Below the Trade ticket: the market's live facts, how leverage works, and common questions. */
export function TradeSections({ market, side, leverage, openPositions, connected }: {
  market: MarketSymbol;
  side: 'long' | 'short';
  leverage: { min: number; max: number };
  openPositions: number | null;
  connected: boolean;
}) {
  const live = useLiveMarketQuote(market);
  const history = useMarketHistory(market, '1D');
  // The live ticker carries the 24h range; otherwise derive it from the day's history points.
  const points = history.snapshot?.points.map((point) => point.price) ?? [];
  const low = live.isFresh ? live.quote?.low24h : points.length ? Math.min(...points) : undefined;
  const high = live.isFresh ? live.quote?.high24h : points.length ? Math.max(...points) : undefined;
  const rangeStatus = history.status === 'loading' && !live.isFresh ? 'loading' : 'unavailable';
  return <PageSections label={`${market} market details`}>
    <Section id="trade-market" eyebrow={`${market} / USD`} title="Market at a glance" action={{ label: 'Positions', href: '/positions' }}>
      <StatGrid stats={[
        { label: '24h low', value: <ValueOrSkeleton value={formatUsdPrice(low)} width="lg" status={rangeStatus} label="24 hour low" />, hint: 'Display price' },
        { label: '24h high', value: <ValueOrSkeleton value={formatUsdPrice(high)} width="lg" status={rangeStatus} label="24 hour high" />, hint: 'Display price' },
        { label: 'Leverage', value: `${leverage.min.toFixed(1)}×–${leverage.max.toFixed(1)}×`, hint: `${side === 'long' ? 'Long' : 'Short'} pool, live limit` },
        { label: 'Your positions', value: openPositions === null ? '—' : `${openPositions} open`, hint: connected ? 'Ethereum · f(x) Protocol' : 'Connect a wallet to see them' },
      ]} />
    </Section>
    <Section id="trade-how" eyebrow="How it works" title="Leverage in three steps">
      <Steps steps={[
        { icon: TrendingUp, title: 'Pick a direction', body: 'Long gains when the price rises; short gains when it falls. Positions settle on f(x) Protocol on Ethereum.' },
        { icon: Gauge, title: 'Choose leverage', body: 'Leverage multiplies exposure within the pool’s live range. More leverage moves a position closer to the protocol’s thresholds.' },
        { icon: Signature, title: 'Review, then sign', body: 'FxAeon simulates the exact route and shows each step, fee, and minimum output before your wallet opens.' },
      ]} />
      {rebalancingNote}
    </Section>
    <Section id="trade-questions" eyebrow="Questions" title="Before you trade" action={{ label: 'Trade docs', href: '/docs#trade' }}>
      <Questions items={[
        { question: 'What can I trade here?', answer: 'ETH and BTC, long or short, on Ethereum through f(x) Protocol. Pay with the input asset you choose in the amount field.' },
        { question: 'How do I close or adjust a position?', answer: 'Open Positions to increase, reduce, close, or adjust leverage. Every change gets its own review before your wallet opens.' },
        { question: 'What do position values mean?', answer: 'Collateral, debt, and value are display estimates read from Ethereum. They are not liquidation levels or execution quotes.' },
        { question: 'Why can a review change before I sign?', answer: 'Prices and pool limits move. If the preview expires or signing details change, FxAeon shows the updated details and asks you to choose the action again.' },
      ]} />
    </Section>
  </PageSections>;
}

/** Below the fxSAVE form: vault facts, how saving works, and common questions. */
export function EarnSections({ apy, cooldown, instantFee }: { apy: string | null; cooldown: string | null; instantFee: string | null }) {
  return <PageSections label="fxSAVE details">
    <Section id="earn-glance" eyebrow="fxSAVE" title="The vault at a glance">
      <StatGrid stats={[
        { label: 'Variable APY', value: apy ?? '—', hint: 'Official f(x) feed, display only' },
        { label: 'Withdrawal cooldown', value: cooldown ?? '—', hint: 'For queued withdrawals' },
        { label: 'Instant withdrawal fee', value: instantFee ?? '—', hint: 'Skip the cooldown' },
        { label: 'Deposit with', value: 'fxUSD · USDC', hint: 'Ethereum' },
      ]} />
    </Section>
    <Section id="earn-how" eyebrow="How it works" title="Saving with fxSAVE">
      <Steps steps={[
        { icon: Coins, title: 'Deposit fxUSD or USDC', body: 'You receive fxSAVE, a share of f(x) Protocol’s savings vault.' },
        { icon: PiggyBank, title: 'Hold fxSAVE', body: 'Its value per share follows the vault. The APY is variable and comes from f(x) Protocol’s official feed.' },
        { icon: Clock3, title: 'Withdraw your way', body: 'Withdraw instantly for a fee, or queue it and claim once the cooldown ends.' },
      ]} />
    </Section>
    <Section id="earn-questions" eyebrow="Questions" title="Before you deposit" action={{ label: 'Earn docs', href: '/docs#earn' }}>
      <Questions items={[
        { question: 'Is the APY guaranteed?', answer: 'No. It is variable and shown for information from f(x) Protocol’s feed. It never changes what you sign.' },
        { question: 'How does a queued withdrawal work?', answer: 'It stays pending through the cooldown. When it is ready, Claim appears here on Earn and on your Portfolio.' },
        { question: 'Can I use fxSAVE on Base?', answer: 'Yes. Move bridges fxUSD and fxSAVE between Ethereum and Base.' },
      ]} />
    </Section>
  </PageSections>;
}

/** Below the Borrow form: the pool's terms, how borrowing works, and common questions. */
export function BorrowSections({ ltvLimit }: { ltvLimit: string }) {
  return <PageSections label="Borrowing details">
    <Section id="borrow-glance" eyebrow="Borrow fxUSD" title="Terms at a glance" action={{ label: 'Borrowing details', href: FX_BORROWING_DOCS, external: true }}>
      <StatGrid stats={[
        { label: 'Loan-to-value limit', value: ltvLimit, hint: 'Live from the pool' },
        { label: 'Annual interest', value: '0%', hint: 'In normal conditions; protocol fees apply' },
        { label: 'Collateral', value: 'ETH · BTC', hint: 'ETH, stETH, wstETH, or WBTC' },
        { label: 'You borrow', value: 'fxUSD', hint: 'On Ethereum' },
      ]} />
    </Section>
    <Section id="borrow-how" eyebrow="How it works" title="Borrowing in three steps">
      <Steps steps={[
        { icon: Wallet, title: 'Deposit collateral', body: 'ETH, stETH, wstETH, or WBTC opens a collateral position on Ethereum.' },
        { icon: CircleDollarSign, title: 'Borrow fxUSD', body: 'Borrow up to the pool’s limit for your collateral. The form shows the exact ceiling as you type.' },
        { icon: BadgeCheck, title: 'Repay to withdraw', body: 'Repay fxUSD at any time and withdraw collateral within the position’s limits.' },
      ]} />
      {rebalancingNote}
    </Section>
    <Section id="borrow-questions" eyebrow="Questions" title="Before you borrow" action={{ label: 'Borrow docs', href: '/docs#borrow' }}>
      <Questions items={[
        { question: 'What does the loan-to-value limit mean?', answer: 'Debt as a share of collateral value. Each pool sets a range, and FxAeon keeps a small margin under the top so a quote still fits when you sign.' },
        { question: 'Can I add collateral or borrow more later?', answer: 'Yes. Under Your positions, add collateral, borrow more, repay, or withdraw. Each change gets its own review.' },
        { question: 'What happens if prices fall?', answer: 'Your loan-to-value rises. Automatic rebalancing can reduce leverage at protocol thresholds, and liquidation remains possible. Repaying or adding collateral lowers it.' },
      ]} />
    </Section>
  </PageSections>;
}

/** Below Move: supported routes, how delivery works, and common questions. */
export function MoveSections() {
  return <PageSections label="Move details">
    <Section id="move-glance" eyebrow="Move" title="Routes at a glance">
      <StatGrid stats={[
        { label: 'Assets', value: 'fxUSD · fxSAVE', hint: 'Official f(x) bridge' },
        { label: 'Networks', value: 'Ethereum ↔ Base', hint: 'Both directions' },
        { label: 'Bridge', value: 'LayerZero', hint: 'Delivery verified by events' },
        { label: 'Fee', value: 'At review', hint: 'Paid in ETH on the source network' },
      ]} />
    </Section>
    <Section id="move-how" eyebrow="How it works" title="Moving between networks">
      <Steps steps={[
        { icon: Route, title: 'Choose route and amount', body: 'Pick the direction, the asset, and how much. The recipient defaults to your wallet.' },
        { icon: ArrowLeftRight, title: 'Approve and send', body: 'Ethereum may need one approval first. Your wallet pays the LayerZero fee shown in the review.' },
        { icon: Layers2, title: 'Delivery', body: 'Source confirmation and destination delivery are tracked separately; FxAeon verifies the matching LayerZero events.' },
      ]} />
    </Section>
    <Section id="move-questions" eyebrow="Questions" title="Before you move" action={{ label: 'Move docs', href: '/docs#move' }}>
      <Questions items={[
        { question: 'How long does a move take?', answer: 'It depends on both networks and LayerZero. History tracks the source confirmation and the delivery separately.' },
        { question: 'Can I send to another wallet?', answer: 'Yes. Choose Use another wallet and enter the recipient’s address on the destination network.' },
        { question: 'What are custom contracts?', answer: 'An expert mode for other LayerZero tokens. Check every address and network before you approve.' },
      ]} />
    </Section>
  </PageSections>;
}
