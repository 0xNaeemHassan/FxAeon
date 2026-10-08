'use client';

import { ArrowLeftRight, BadgeCheck, CircleDollarSign, Clock3, Coins, Gauge, Layers2, PiggyBank, Route, ShieldAlert, Signature, TrendingUp, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Segmented } from '@/components/ProtocolForm';
import { useLiveMarketQuote } from '@/components/PriceProvider';
import { liveQuotePending } from '@/lib/liveMarket';
import { ValueOrSkeleton } from '@/components/MissingValue';
import { formatUsdPrice } from '@/lib/prices';
import type { MarketSymbol } from '@/lib/marketData';
import { Callout, PageSections, Questions, Section, StatGrid, Steps } from '@/components/PageSections';
import { YieldFlow } from '@/components/YieldFlow';
import { LeverageSplit } from '@/components/LeverageSplit';
import { leverageDebtLabel } from '@/lib/leverageShare';
import styles from '@/components/PageSections.module.css';

// Reviewed f(x) Protocol references, the same ones the landing page links.
const FX_REBALANCING_DOCS = 'https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/rebalancing-the-position-liquidation-brake';
const FX_BORROWING_DOCS = 'https://fxprotocol.gitbook.io/fx-docs/f-x-protocol-mechanisms/fxmint-borrowing-fxusd-against-your-btc-and-eth';

const rebalancingNote = <Callout icon={ShieldAlert} title="A brake before liquidation" link={{ label: 'How rebalancing works', href: FX_REBALANCING_DOCS }}>
  Automatic rebalancing can reduce leverage at protocol thresholds. Liquidation remains possible, so keep room between your position and the limits.
</Callout>;

/** Local examples only: comparing directions never edits the trade ticket. */
function TradeLeverageExample({ market, side }: { market: MarketSymbol; side: 'long' | 'short' }) {
  const [exampleSide, setExampleSide] = useState(side);
  return <>
    {/* Named as an example, on screen and to assistive tech, so it never reads as a second side control. */}
    <div className={styles.exampleSwitch}>
      <span className={styles.exampleCaption} aria-hidden="true">Example</span>
      <Segmented value={exampleSide} onChange={setExampleSide} ariaLabel="Leverage example" options={[{ value: 'long', label: 'Long', ariaLabel: 'Long example' }, { value: 'short', label: 'Short', ariaLabel: 'Short example' }]} />
    </div>
    <p className={styles.lede}>{exampleSide === 'long'
      ? 'On f(x) Protocol, a long’s leverage is fxUSD minted against its collateral. Before fees, a 3× long is two thirds minted fxUSD and one third yours.'
      : `A short deposits fxUSD and borrows ${market === 'ETH' ? 'wstETH' : 'WBTC'} from f(x) Protocol’s long-side reserve. Before fees, a 3× short is three quarters borrowed and one quarter yours.`}</p>
    <LeverageSplit side={exampleSide} debtLabel={leverageDebtLabel(exampleSide, market)} />
  </>;
}

/** Below the Trade ticket: the market's live facts, how leverage works, and common questions. */
export function TradeSections({ market, side, leverage, openPositions, positionsStatus }: {
  market: MarketSymbol;
  side: 'long' | 'short';
  leverage: { min: number; max: number };
  openPositions: number | null;
  positionsStatus: 'disconnected' | 'loading' | 'unavailable' | 'ready';
}) {
  const live = useLiveMarketQuote(market);
  // The live ticker carries the 24h range. Chart history stays cold until the
  // chart itself is opened, so a stale ticker shows the range as unavailable.
  const low = live.isFresh ? live.quote?.low24h : undefined;
  const high = live.isFresh ? live.quote?.high24h : undefined;
  const rangeStatus = liveQuotePending(live.status) ? 'loading' : 'unavailable';
  return <PageSections label={`${market} market details`}>
    <Section id="trade-market" title={`${market} at a glance`} action={{ label: 'Manage positions', href: '/positions' }}>
      <StatGrid stats={[
        { label: '24h low', value: <ValueOrSkeleton value={formatUsdPrice(low)} width="lg" status={rangeStatus} label="24 hour low" />, hint: 'Display price' },
        { label: '24h high', value: <ValueOrSkeleton value={formatUsdPrice(high)} width="lg" status={rangeStatus} label="24 hour high" />, hint: 'Display price' },
        { label: 'Leverage', value: `${leverage.min.toFixed(1)}×–${leverage.max.toFixed(1)}×`, hint: `${side === 'long' ? 'Long' : 'Short'} pool, live limit` },
        // Without a wallet there is nothing of yours to count, so the tile names the network instead.
        positionsStatus === 'disconnected'
          ? { label: 'Network', value: 'Ethereum', hint: 'f(x) Protocol pools' }
          : { label: 'Your positions', value: <ValueOrSkeleton value={positionsStatus === 'ready' && openPositions !== null ? `${openPositions} open` : '—'} width="md" status={positionsStatus === 'loading' ? 'loading' : 'unavailable'} label="Your open positions" />, hint: 'Ethereum · f(x) Protocol' },
      ]} />
    </Section>
    <Section id="trade-how" title="Leverage in three steps">
      <TradeLeverageExample key={`${market}:${side}`} market={market} side={side} />
      <Steps steps={[
        { icon: TrendingUp, title: 'Pick a direction', body: 'Long gains when the price rises; short gains when it falls. Positions settle on f(x) Protocol on Ethereum.' },
        { icon: Gauge, title: 'Choose leverage', body: 'Leverage multiplies exposure within the pool’s live range. More leverage moves a position closer to the protocol’s thresholds.' },
        { icon: Signature, title: 'Review, then sign', body: 'FxAeon simulates the exact route and shows each step, fee, and minimum output before your wallet opens.' },
      ]} />
      {rebalancingNote}
    </Section>
    <Section id="trade-questions" title="Before you trade" action={{ label: 'Trade docs', href: '/docs#trade' }}>
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
export function EarnSections({ apy, apyStatus, cooldown, instantFee, vaultStatus }: {
  apy: string | null;
  apyStatus: 'loading' | 'unavailable';
  cooldown: string | null;
  instantFee: string | null;
  /** How the vault configuration read stands while its values are missing. */
  vaultStatus: 'loading' | 'unavailable';
}) {
  return <PageSections label="fxSAVE details">
    <Section id="earn-glance" title="The vault at a glance">
      <StatGrid stats={[
        { label: 'APY', value: <ValueOrSkeleton value={apy ?? '—'} width="md" status={apyStatus} label="fxSAVE APY" />, hint: 'Variable · official f(x) feed' },
        { label: 'Withdrawal cooldown', value: <ValueOrSkeleton value={cooldown ?? '—'} width="md" status={vaultStatus} label="Withdrawal cooldown" />, hint: 'For queued withdrawals' },
        { label: 'Instant withdrawal fee', value: <ValueOrSkeleton value={instantFee ?? '—'} width="md" status={vaultStatus} label="Instant withdrawal fee" />, hint: 'Skip the cooldown' },
        { label: 'Deposit with', value: 'fxUSD · USDC', hint: 'Ethereum' },
      ]} />
    </Section>
    <Section id="earn-how" title="Saving with fxSAVE">
      <YieldFlow />
      <Steps steps={[
        { icon: Coins, title: 'Deposit fxUSD or USDC', body: 'You receive fxSAVE, a share of f(x) Protocol’s savings vault.' },
        { icon: PiggyBank, title: 'Hold fxSAVE', body: 'The vault holds stability pool shares and compounds what they earn from position fees, wstETH staking, and USDC lending, so its value per share follows the vault. The APY is variable and comes from f(x) Protocol’s official feed.' },
        { icon: Clock3, title: 'Withdraw your way', body: 'Withdraw instantly for a fee, or queue it and claim once the cooldown ends.' },
      ]} />
    </Section>
    <Section id="earn-questions" title="Before you deposit" action={{ label: 'Earn docs', href: '/docs#earn' }}>
      <Questions items={[
        { question: 'Is the APY guaranteed?', answer: 'No. It is variable and shown for information from f(x) Protocol’s feed. It never changes what you sign.' },
        { question: 'What does the stability pool do?', answer: 'It holds fxUSD and USDC, keeps fxUSD near a dollar by buying it below the peg and selling it above, and supplies the funds that rebalance leveraged positions. Its depositors earn from position fees, wstETH staking, and USDC lending; fxSAVE compounds those rewards.' },
        { question: 'How does a queued withdrawal work?', answer: 'It stays pending through the cooldown. When it is ready, Claim appears here on Earn and on your Portfolio.' },
        { question: 'Can I use fxSAVE on Base?', answer: 'Yes. Move bridges fxUSD and fxSAVE between Ethereum and Base.' },
      ]} />
    </Section>
  </PageSections>;
}

/** Below the Borrow form: the pool's terms, how borrowing works, and common questions. */
export function BorrowSections({ ltvLimit }: { ltvLimit: string }) {
  return <PageSections label="Borrowing details">
    <Section id="borrow-glance" title="Terms at a glance" action={{ label: 'Borrowing details', href: FX_BORROWING_DOCS, external: true }}>
      <StatGrid stats={[
        { label: 'Loan-to-value limit', value: ltvLimit, hint: 'Live from the pool' },
        { label: 'Annual interest', value: '0%', hint: 'In normal conditions; protocol fees apply' },
        { label: 'Collateral', value: 'ETH · BTC', hint: 'ETH, stETH, wstETH, or WBTC' },
        { label: 'You borrow', value: 'fxUSD', hint: 'On Ethereum' },
      ]} />
    </Section>
    <Section id="borrow-how" title="Borrowing in three steps">
      <Steps steps={[
        { icon: Wallet, title: 'Deposit collateral', body: 'ETH, stETH, wstETH, or WBTC opens a collateral position on Ethereum.' },
        { icon: CircleDollarSign, title: 'Borrow up to the limit', body: 'The form shows how much fxUSD your collateral can support as you type, and names anything missing before review.' },
        { icon: BadgeCheck, title: 'Repay to withdraw', body: 'Repay fxUSD at any time and withdraw collateral within the position’s limits.' },
      ]} />
      {rebalancingNote}
    </Section>
    <Section id="borrow-questions" title="Before you borrow" action={{ label: 'Borrow docs', href: '/docs#borrow' }}>
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
    <Section id="move-glance" title="Routes at a glance">
      <StatGrid stats={[
        { label: 'Assets', value: 'fxUSD · fxSAVE', hint: 'Official f(x) bridge' },
        { label: 'Networks', value: 'Ethereum ↔ Base', hint: 'Both directions' },
        { label: 'Bridge', value: 'LayerZero', hint: 'Delivery verified by events' },
        { label: 'Fee', value: 'At review', hint: 'Paid in ETH on the source network' },
      ]} />
    </Section>
    <Section id="move-how" title="Moving between networks">
      <Steps steps={[
        { icon: Route, title: 'Choose route and amount', body: 'Pick the direction, the asset, and how much. The recipient defaults to your wallet.' },
        { icon: ArrowLeftRight, title: 'Approve and send', body: 'Ethereum may need one approval first. Your wallet pays the LayerZero fee shown in the review.' },
        { icon: Layers2, title: 'Delivery', body: 'Source confirmation and destination delivery are tracked separately; FxAeon verifies the matching LayerZero events.' },
      ]} />
    </Section>
    <Section id="move-questions" title="Before you move" action={{ label: 'Move docs', href: '/docs#move' }}>
      <Questions items={[
        { question: 'How long does a move take?', answer: 'It depends on both networks and LayerZero. History tracks the source confirmation and the delivery separately.' },
        { question: 'Can I send to another wallet?', answer: 'Yes. Choose Use another wallet and enter the recipient’s address on the destination network.' },
        { question: 'When would I use expert mode?', answer: 'Expert mode exposes token and deployment fields for other LayerZero routes. Check every address and network before you approve.' },
      ]} />
    </Section>
  </PageSections>;
}
