'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, RefreshCw, ShieldCheck, Sparkles, WalletCards } from 'lucide-react';
import { PROTOCOL_TOKENS, RISK_PARAMS } from '@fxaeon/shared';
import { AppShell, Button, Card } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import { AmountField, InfoNote, RangeField, Segmented, TokenSelect } from '@/components/ProtocolForm';
import { HealthGauge } from '@/components/HealthGauge';
import { TradingChart } from '@/components/TradingChart';
import { PnLSimulator } from '@/components/PnLSimulator';
import { QuickCommandBar, type ParsedTradeCommand } from '@/components/QuickCommandBar';
import { sound } from '@/lib/sound';
import { getMe, type Market, type Me, type MiniActionParams, type PositionSide, type ProtocolTokenSymbol } from '@/lib/api';
import { positiveDecimal } from '@/lib/amount';
import { useLiveRefresh } from '@/lib/useLiveRefresh';

const TOKENS: Record<Market, readonly ProtocolTokenSymbol[]> = {
  wstETH: ['ETH', 'WETH', 'stETH', 'wstETH', 'USDC', 'USDT', 'fxUSD'],
  WBTC: ['WBTC', 'USDC', 'USDT', 'fxUSD'],
};

export default function TradePage() {
  const [market, setMarket] = useState<Market>('wstETH');
  const [side, setSide] = useState<PositionSide>('long');
  const [token, setToken] = useState<ProtocolTokenSymbol>('ETH');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(3);
  const [me, setMe] = useState<Me | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState('');

  const [livePrice, setLivePrice] = useState<number>(3500);
  const [tpPrice, setTpPrice] = useState<number | null>(null);
  const [slPrice, setSlPrice] = useState<number | null>(null);

  const maxLeverage = side === 'long' ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
  const validAmount = positiveDecimal(amount, PROTOCOL_TOKENS[token].decimals);

  // Dynamic estimated liquidation price
  const liquidationPrice = useMemo(() => {
    if (!livePrice || leverage <= 1) return null;
    const dropFraction = 1 / leverage;
    return side === 'long'
      ? livePrice * (1 - dropFraction * 0.95)
      : livePrice * (1 + dropFraction * 0.95);
  }, [leverage, livePrice, side]);

  const loadWallet = useCallback(async () => {
    setWalletLoading(true);
    setWalletError('');
    try {
      setMe(await getMe());
    } catch (cause) {
      setWalletError(cause instanceof Error ? cause.message : 'Wallet balances are unavailable.');
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => { void loadWallet(); }, [loadWallet]);
  useLiveRefresh(loadWallet);

  useEffect(() => {
    if (!TOKENS[market].includes(token)) setToken(TOKENS[market][0]);
    setLeverage((value) => Math.min(maxLeverage, Math.max(RISK_PARAMS.MIN_LEVERAGE, value)));
  }, [market, maxLeverage, token]);

  const handleQuickCommand = useCallback((cmd: ParsedTradeCommand) => {
    if (cmd.market) setMarket(cmd.market);
    if (cmd.side) setSide(cmd.side);
    if (cmd.leverage) setLeverage(cmd.leverage);
    if (cmd.amount) setAmount(cmd.amount);
  }, []);

  const params = useMemo<MiniActionParams | null>(() => {
    if (!validAmount) return null;
    return { kind: 'position_open', market, side, inputToken: token, amount: validAmount, leverage };
  }, [leverage, market, side, token, validAmount]);

  return (
    <AppShell title="Trade" subtitle="Open an f(x) leveraged position from any SDK-supported input asset.">
      <div className="stagger flex flex-col gap-3.5">
        {/* Quick Voice / Text Command Bar */}
        <QuickCommandBar onApplyTrade={handleQuickCommand} />

        {/* Live Interactive Candlestick / Area Chart */}
        <TradingChart
          market={market}
          currentPrice={livePrice}
          liquidationPrice={liquidationPrice}
          takeProfitPrice={tpPrice}
          stopLossPrice={slPrice}
          onPriceUpdate={setLivePrice}
        />

        <Card glow className="overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-[rgba(139,109,255,.16)] blur-3xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">Position builder</p>
              <p className="text-display mt-2 break-words text-[clamp(1.35rem,7vw,1.75rem)] font-semibold tracking-[-0.045em]">
                {validAmount ? `${validAmount} ${token}` : 'Set your size'}
              </p>
              <p className="mt-1 text-[11px] text-mut">Funding amount · final market exposure comes only from the live SDK route</p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><Sparkles className="h-5 w-5" /></span>
          </div>
        </Card>

        <Segmented
          value={market}
          onChange={(m) => {
            sound.tap();
            setMarket(m);
          }}
          ariaLabel="Market"
          options={[{ value: 'wstETH', label: 'ETH market', sub: 'wstETH pool' }, { value: 'WBTC', label: 'BTC market', sub: 'WBTC pool' }]}
        />

        <Segmented
          value={side}
          onChange={(s) => {
            sound.tap();
            setSide(s);
          }}
          ariaLabel="Direction"
          options={[{ value: 'long', label: 'Long', sub: 'Price rises' }, { value: 'short', label: 'Short', sub: 'Price falls' }]}
        />

        <Card className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${side === 'long' ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'}`}>
              {side === 'long' ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
            </span>
            <div><h2 className="text-[14px] font-semibold">{market} {side}</h2><p className="mt-0.5 text-[10.5px] text-mut">Choose funding asset, size and leverage.</p></div>
          </div>
          <div className="flex flex-col gap-4">
            <TokenSelect label="Pay with" value={token} options={TOKENS[market]} onChange={setToken} />
            <AmountField label="Input amount" symbol={token} value={amount} onChange={setAmount} balance={walletLoading ? undefined : me?.funding?.balances?.[token]} maxDecimals={PROTOCOL_TOKENS[token].decimals} />
            <RangeField
              label="Leverage"
              value={leverage}
              onChange={(lev) => {
                setLeverage(lev);
              }}
              min={RISK_PARAMS.MIN_LEVERAGE}
              max={maxLeverage}
              step={0.1}
            />
            <HealthGauge mode="leverage" value={leverage} side={side} market={market} />

            {/* PnL & Take-Profit/Stop-Loss Target Simulator */}
            <PnLSimulator
              side={side}
              leverage={leverage}
              entryPrice={livePrice}
              marginUsd={validAmount ? parseFloat(validAmount) * (token.includes('USD') ? 1 : livePrice) : 0}
              onTakeProfitChange={setTpPrice}
              onStopLossChange={setSlPrice}
            />

            <InfoNote>
              Leveraged positions may be liquidated. The review uses a fresh SDK execution route, live gas, your saved slippage, and fail-closed simulation.
            </InfoNote>
          </div>
        </Card>

        {walletError && (
          <Card className="border-[rgba(255,194,102,.24)] p-3.5">
            <p role="alert" className="text-[11.5px] leading-relaxed text-warn">Wallet balance unavailable: {walletError}</p>
            <Button variant="ghost" className="mt-2" onClick={() => void loadWallet()}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" /> Retry balances
            </Button>
          </Card>
        )}

        <ActionReview params={params} label={`Review ${market} ${side}`} onComplete={() => void loadWallet()} />

        <div className="grid grid-cols-2 gap-2.5">
          <Link href="/positions" className="glass glass-press flex min-h-16 items-center gap-2.5 p-3 text-[11px] font-semibold"><WalletCards className="h-4 w-4 text-mint" aria-hidden="true" /> Manage positions</Link>
          <Link href="/borrow" className="glass glass-press flex min-h-16 items-center gap-2.5 p-3 text-[11px] font-semibold"><ShieldCheck className="h-4 w-4 text-mint" aria-hidden="true" /> Mint fxUSD</Link>
        </div>
      </div>
    </AppShell>
  );
}
