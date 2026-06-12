'use client';

/**
 * Trade builder — pick market, side, leverage and size, then confirm in the
 * bot chat. The Mini App NEVER executes trades itself (kill-switch, see
 * docs/audit/AUDIT.md P0-2): the deep link carries unsigned params (`tq_*`),
 * and the bot re-validates, signs and shows an inline Confirm/Cancel preview
 * before anything touches the chain.
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrendingUp, TrendingDown, ArrowRight, ShieldCheck } from 'lucide-react';
import { getWebApp, haptic, isTMA, showMainButton } from '@/lib/telegram';
import { RISK_PARAMS } from '@fxbot/shared';
import { AppShell, Button, Card, FullScreenSpinner, SectionTitle } from '@/components/ui';

const MARKET_INDEX: Record<string, number> = { wstETH: 0, WBTC: 1 };
const MARKETS = Object.keys(MARKET_INDEX);
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

function buildBotDeepLink(
  market: string,
  side: string,
  leverage: number,
  amount: number
): string | null {
  const mIdx = MARKET_INDEX[market];
  if (mIdx === undefined || !Number.isFinite(leverage) || !(amount > 0)) return null;
  const payload = `tq_${mIdx}_${side === 'short' ? 's' : 'l'}_${Math.round(leverage * 10)}_${Math.round(amount * 1e6)}`;
  return `https://t.me/${BOT_USERNAME}?start=${payload}`;
}

function TradeContent() {
  const searchParams = useSearchParams();

  const [market, setMarket] = useState(
    MARKET_INDEX[searchParams.get('market') ?? ''] !== undefined
      ? (searchParams.get('market') as string)
      : 'wstETH'
  );
  const [side, setSide] = useState<'long' | 'short'>(
    searchParams.get('side') === 'short' ? 'short' : 'long'
  );
  const [leverage, setLeverage] = useState(() => {
    const v = parseFloat(searchParams.get('lev') || '3');
    return Number.isFinite(v) ? v : 3;
  });
  const [amount, setAmount] = useState(searchParams.get('amt') || '');

  const isLong = side === 'long';
  const maxLev = isLong ? RISK_PARAMS.MAX_LEVERAGE_LONG : RISK_PARAMS.MAX_LEVERAGE_SHORT;
  const minLev = RISK_PARAMS.MIN_LEVERAGE;

  // Side switches can lower the cap — clamp instead of erroring.
  useEffect(() => {
    setLeverage((l) => Math.min(Math.max(l, minLev), maxLev));
  }, [maxLev, minLev]);

  const amt = parseFloat(amount);
  const valid = Number.isFinite(amt) && amt > 0 && leverage >= minLev && leverage <= maxLev;
  const deepLink = useMemo(
    () => (valid ? buildBotDeepLink(market, side, leverage, amt) : null),
    [valid, market, side, leverage, amt]
  );

  const openInBot = () => {
    if (!deepLink) return;
    haptic('success');
    const tg = getWebApp();
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(deepLink);
      tg.close();
    } else {
      window.open(deepLink, '_blank');
    }
  };

  // Native MainButton mirrors the confirm CTA inside Telegram.
  useEffect(() => {
    if (!isTMA() || !valid) return;
    return showMainButton(`Review ${leverage}x ${side} in chat`, openInBot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, leverage, side, market, amount]);

  const fill = ((leverage - minLev) / (maxLev - minLev)) * 100;
  const exposure = valid ? (amt * leverage).toLocaleString('en-US', { maximumFractionDigits: 4 }) : null;

  return (
    <AppShell title="Trade" subtitle="Leveraged positions on f(x) Protocol">
      <div className="stagger flex flex-col gap-3.5">
        {/* Market */}
        <div className="grid grid-cols-2 gap-2.5">
          {MARKETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                haptic('selection');
                setMarket(m);
              }}
              className={`glass glass-press p-4 text-left ${
                market === m ? 'border-[rgba(46,230,168,0.45)] bg-[var(--mint-dim)]' : ''
              }`}
            >
              <p className="text-display text-[17px] font-semibold">{m}</p>
              <p className="mt-0.5 text-[11px] text-mut">
                up to {m === market && !isLong ? RISK_PARAMS.MAX_LEVERAGE_SHORT : RISK_PARAMS.MAX_LEVERAGE_LONG}x
              </p>
            </button>
          ))}
        </div>

        {/* Side */}
        <div className="glass flex gap-1 p-1">
          {(['long', 'short'] as const).map((s) => {
            const active = side === s;
            const Icon = s === 'long' ? TrendingUp : TrendingDown;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  haptic('selection');
                  setSide(s);
                }}
                className={`glass-press flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[14px] font-medium capitalize transition-colors ${
                  active
                    ? s === 'long'
                      ? 'bg-[var(--mint-dim)] text-mint'
                      : 'bg-[rgba(255,107,107,0.12)] text-danger'
                    : 'text-mut'
                }`}
              >
                <Icon className="h-4 w-4" /> {s}
              </button>
            );
          })}
        </div>

        {/* Leverage */}
        <Card>
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] uppercase tracking-wide text-mut">Leverage</span>
            <span className="text-display text-[24px] font-semibold text-gradient">
              {leverage.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            className="lever mt-4"
            min={minLev}
            max={maxLev}
            step={0.1}
            value={leverage}
            style={{ ['--fill' as string]: `${fill}%` }}
            onChange={(e) => {
              haptic('selection');
              setLeverage(parseFloat(e.target.value));
            }}
          />
          <div className="mt-1.5 flex justify-between text-[11px] text-mut">
            <span>{minLev}x</span>
            <span>{maxLev}x max ({side})</span>
          </div>
        </Card>

        {/* Amount */}
        <Card>
          <label htmlFor="amt" className="text-[12px] uppercase tracking-wide text-mut">
            Collateral ({market})
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="amt"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="text-display w-full bg-transparent text-[28px] font-semibold outline-none placeholder:text-[rgba(255,255,255,0.18)]"
            />
            <span className="text-[13px] font-medium text-mut">{market}</span>
          </div>
          {exposure && (
            <p className="mt-2 text-[12px] text-mut">
              Total exposure ≈ <span className="text-mint">{exposure} {market}</span>
            </p>
          )}
        </Card>

        {/* Confirm */}
        <Button onClick={openInBot} disabled={!valid} className="mt-1">
          Review &amp; confirm in chat <ArrowRight className="h-4 w-4" />
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-center text-[11.5px] text-mut">
          <ShieldCheck className="h-3.5 w-3.5 text-mint" />
          The bot shows a signed preview — nothing executes until you confirm there.
        </p>
      </div>
    </AppShell>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <TradeContent />
    </Suspense>
  );
}
