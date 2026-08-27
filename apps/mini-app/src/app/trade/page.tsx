'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, ShieldCheck, WalletCards } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, InfoNote, LeverageField, Segmented, SlippageField, TokenSelect } from '@/components/ProtocolForm';
import { MAX_FX_SLIPPAGE_PERCENT, planIncreasePosition } from '@/lib/fx';
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

  useEffect(() => {
    setSlippage(String(readSlippagePercent()));
  }, []);

  const tokenOptions = positionInputTokenOptions(market);
  const validAmount = positiveDecimal(amount, tokenDecimals(token));

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
    <AppShell title="Trade" subtitle="Open a long or short position through the official f(x) SDK.">
      <div className="stagger flex flex-col gap-3.5">
        <Card glow className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">SDK position builder</p>
              <h2 className="text-display mt-2 text-[25px] font-semibold">Trade with live protocol routes</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-mut">No synthetic prices, PnL, liquidation estimates, or off-chain quotes are used here.</p>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><ShieldCheck className="h-5 w-5" /></span>
          </div>
        </Card>

        <Segmented value={market} onChange={(next) => { setMarket(next); setToken(next === 'ETH' ? 'ETH' : 'WBTC'); }} ariaLabel="Market" options={[{ value: 'ETH', label: 'ETH market', sub: 'Long / short' }, { value: 'BTC', label: 'BTC market', sub: 'Long / short' }]} />
        <Segmented value={side} onChange={setSide} ariaLabel="Position side" options={[{ value: 'long', label: 'Long', sub: 'Price rises' }, { value: 'short', label: 'Short', sub: 'Price falls' }]} />

        <Card className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>
              {side === 'long' ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
            </span>
            <div><h2 className="text-[14px] font-semibold">Open {market} {side}</h2><p className="mt-0.5 text-[10.5px] text-mut">The SDK chooses and returns the available execution routes.</p></div>
          </div>
          <div className="flex flex-col gap-4">
            <TokenSelect label="Input asset" value={token} options={tokenOptions} onChange={setToken} />
            <AmountField label="Input amount" symbol={token} value={amount} onChange={setAmount} maxDecimals={tokenDecimals(token)} />
            <LeverageField value={leverage} onChange={setLeverage} />
            <SlippageField value={slippage} onChange={setSlippage} max={MAX_FX_SLIPPAGE_PERCENT} />
            <InfoNote>Every route is simulated before review. You approve each SDK transaction in Privy, in the exact order returned by the protocol.</InfoNote>
          </div>
        </Card>

        {!wallet.address && <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Choose or connect the wallet that will authorize every SDK transaction. Nothing is signed until you approve it in Privy." />}
        <ActionReview planBuilder={planBuilder} label={`Review open ${market} ${side}`} operationLabel={`Open ${market} ${side}`} onComplete={async () => { if (wallet.address) await readAllPositions(wallet.address); }} />

        <div className="grid grid-cols-2 gap-2.5">
          <Link href="/positions" className="glass glass-press flex min-h-16 items-center gap-2.5 p-3 text-[11px] font-semibold"><WalletCards className="h-4 w-4 text-mint" aria-hidden="true" /> Manage positions</Link>
          <Link href="/borrow" className="glass glass-press flex min-h-16 items-center gap-2.5 p-3 text-[11px] font-semibold"><ShieldCheck className="h-4 w-4 text-mint" aria-hidden="true" /> Mint fxUSD</Link>
        </div>
      </div>
    </AppShell>
  );
}
