'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell, Card } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
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
    <AppShell title="Trade">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 rounded-xl border border-[var(--line)] bg-[rgba(0,0,0,.18)] p-1" aria-label="Trade views">
          <span aria-current="page" className="flex min-h-11 items-center justify-center rounded-lg bg-[var(--mint-dim)] px-3 text-[13px] font-semibold text-[var(--text)]">New position</span>
          <Link href="/positions" className="glass-press flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-mut">Positions</Link>
        </div>

        <Segmented value={market} onChange={(next) => { setMarket(next); setToken(next === 'ETH' ? 'ETH' : 'WBTC'); }} ariaLabel="Market" options={[{ value: 'ETH', label: 'ETH' }, { value: 'BTC', label: 'BTC' }]} />
        <Segmented value={side} onChange={setSide} ariaLabel="Position side" options={[{ value: 'long', label: 'Long', sub: 'Price rises' }, { value: 'short', label: 'Short', sub: 'Price falls' }]} />

        <Card className="p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] text-mut">New position</p>
              <h2 className="mt-0.5 text-[16px] font-semibold">{market} {side === 'long' ? 'Long' : 'Short'}</h2>
            </div>
            <span className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>{side === 'long' ? 'Long' : 'Short'}</span>
          </div>
          <div className="flex flex-col gap-4">
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
      </div>
    </AppShell>
  );
}
