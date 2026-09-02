'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Gauge, Layers2, ShieldCheck } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import { TradeMarketChart } from '@/components/MarketChart';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, LeverageField, Segmented, SlippageField, TokenSelect } from '@/components/ProtocolForm';
import { MAX_FX_SLIPPAGE_PERCENT, clampLeverage, leverageBoundsFor, planIncreasePosition, readLeverageBounds, type LeverageBounds } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { positiveDecimal } from '@/lib/amount';
import { DEFAULT_SLIPPAGE_PERCENT, readSlippagePercent } from '@/lib/settings';
import {
  parseAmount,
  positionInputTokenOptions,
  tokenAddress,
  tokenDecimals,
  type UiMarket,
  type UiSide,
  type UiToken,
  readAllPositions,
} from '@/app/trade/fxUi';

export default function TradePage() {
  const wallet = usePrivyWallet();
  const [market, setMarket] = useState<UiMarket>('ETH');
  const [side, setSide] = useState<UiSide>('long');
  const [token, setToken] = useState<UiToken>('ETH');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(2);
  const [slippage, setSlippage] = useState(String(DEFAULT_SLIPPAGE_PERCENT));
  const [leverageBounds, setLeverageBounds] = useState<LeverageBounds>(() => leverageBoundsFor('ETH', 'long'));

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);

  const tokenOptions = positionInputTokenOptions(market);
  const validAmount = positiveDecimal(amount, tokenDecimals(token));

  useEffect(() => {
    let active = true;
    const fallback = leverageBoundsFor(market, side);
    setLeverageBounds(fallback);
    void readLeverageBounds(market, side).then((next) => {
      if (active) setLeverageBounds(next);
    }).catch(() => {
      // The input remains guarded by the conservative fallback while a public
      // RPC is unavailable; the SDK is still the final route authority.
    });
    return () => { active = false; };
  }, [market, side]);

  useEffect(() => {
    setLeverage((current) => clampLeverage(current, leverageBounds));
  }, [leverageBounds]);

  const leverageError = leverage > 0 && leverage < leverageBounds.min
    ? `Minimum pool leverage is ${leverageBounds.min.toFixed(1)}×.`
    : null;

  useEffect(() => {
    if (!tokenOptions.includes(token)) setToken(tokenOptions[0]);
  }, [token, tokenOptions]);

  const planBuilder = useMemo(() => {
    if (!wallet.address || !validAmount) return null;
    const amountWei = parseAmount(validAmount, token);
    const slippageValue = Number(slippage);
    if (!amountWei || !Number.isFinite(leverage) || leverage <= 0 || !Number.isFinite(slippageValue) || slippageValue <= 0 || slippageValue > MAX_FX_SLIPPAGE_PERCENT) return null;
    return () => planIncreasePosition({
      market,
      type: side,
      positionId: 0,
      userAddress: wallet.address!,
      leverage,
      inputTokenAddress: tokenAddress(token),
      amount: amountWei,
      slippage: slippageValue,
    });
  }, [leverage, market, side, slippage, token, validAmount, wallet.address]);

  return (
    <AppShell tabs>
      <div className="trade-workspace">
        <header className="trade-page-heading">
          <div><p className="page-kicker">f(x) leveraged markets</p><h1 className="text-display mt-1.5 text-[30px] font-semibold leading-tight">Trade</h1></div>
          <Link href="/positions" className="glass-press inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[12px] font-semibold text-mut hover:text-mint"><Layers2 className="h-4 w-4" aria-hidden="true" />Positions</Link>
        </header>

        <Segmented value={market} onChange={(next) => { setMarket(next); setToken(next === 'ETH' ? 'ETH' : 'WBTC'); }} ariaLabel="Market" options={[{ value: 'ETH', label: 'ETH market', sub: 'Ethereum', ariaLabel: 'ETH' }, { value: 'BTC', label: 'BTC market', sub: 'Wrapped BTC', ariaLabel: 'BTC' }]} />
        <TradeMarketChart market={market} />

        <div className="trade-view-tabs" aria-label="Trade views">
          <span aria-current="page">Open position</span>
          <Link href="/positions">Manage positions <ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>

        <Card className="trade-ticket p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="micro-label">New protocol position</p>
              <h2 className="mt-1 text-[18px] font-semibold">{market} {side === 'long' ? 'Long' : 'Short'}</h2>
              <p className="mt-1 text-[11px] text-mut">Official f(x) SDK route · wallet confirmed</p>
            </div>
            <span className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>{side === 'long' ? 'Long' : 'Short'}</span>
          </div>

          <Segmented tone="sides" value={side} onChange={setSide} ariaLabel="Position side" options={[{ value: 'long', label: 'Buy / Long', sub: 'Price rises', ariaLabel: 'Long' }, { value: 'short', label: 'Sell / Short', sub: 'Price falls', ariaLabel: 'Short' }]} />

          <div className="flex flex-col gap-4">
            <div className="trade-route-facts">
              <span><ShieldCheck className="h-4 w-4" aria-hidden="true" /><strong>Self-custodial</strong><small>No delegated signer</small></span>
              <span><Gauge className="h-4 w-4" aria-hidden="true" /><strong>{leverage.toFixed(leverage % 1 ? 1 : 0)}× target</strong><small>{leverageBounds.min.toFixed(1)}×–{leverageBounds.max.toFixed(1)}× pool range</small></span>
            </div>
            <TokenSelect label="Input asset" value={token} options={tokenOptions} onChange={setToken} />
            <AmountField label="Amount" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} />
            <LeverageField label={side === 'short' ? 'Target LSD leverage' : 'Target leverage'} value={leverage} onChange={setLeverage} min={leverageBounds.min} max={leverageBounds.max} error={leverageError} />
            <details className="group rounded-xl border border-[var(--line)] px-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-semibold [&::-webkit-details-marker]:hidden">Advanced <span aria-hidden="true" className="text-mut transition-transform group-open:rotate-180">⌄</span></summary>
              <div className="border-t border-[var(--line)] py-3"><SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} /></div>
            </details>
          </div>
        </Card>

        {!wallet.address && <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Connect a wallet to review this trade." />}
        <ActionReview planBuilder={planBuilder} label={`Review ${market} ${side === 'long' ? 'Long' : 'Short'}`} operationLabel={`Open ${market} ${side}`} onComplete={async () => { if (wallet.address) await readAllPositions(wallet.address); }} />

        <Link href="/positions" className="trade-positions-link glass-press">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--mint-dim)] text-mint"><Layers2 className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-[13px]">Open positions</strong><small className="mt-1 block text-[11px] text-mut">View collateral, debt, live USD context, and adjust exposure.</small></span>
          <ChevronRight className="h-4 w-4 text-mut" aria-hidden="true" />
        </Link>
      </div>
    </AppShell>
  );
}
