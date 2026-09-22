'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import TokenIcon from '@/components/TokenIcon';
import { useUsdPrices } from '@/components/PriceProvider';
import { ValueOrSkeleton } from '@/components/MissingValue';
import type { TokenBalanceView } from '@/components/wallet-balance-cache';
import { calculateFractionDecimal, compareExactDecimals, decimalInputError, formatExactDecimal, positiveDecimal } from '@/lib/amount';
import { formatUsd, formatUsdPrice, priceKeyForSymbol, usdValueForDecimal } from '@/lib/prices';
import { ASSET_PRICE_MAX_AGE_MS } from '@/lib/walletAssets';
import { tokenSymbol } from '@/lib/fx/tokenPresentation';
import { haptic } from '@/lib/telegram';
import styles from './AmountField.module.css';

export type AmountFieldProps = {
  value: string; onChange: (value: string) => void; symbol: string; label: string;
  hint?: string; balance?: string | null; balanceState?: TokenBalanceView;
  allowAll?: boolean; allowZero?: boolean; showPercentages?: boolean; showMax?: boolean;
  showUsdValue?: boolean; showUnitPrice?: boolean; compact?: boolean; disabled?: boolean;
  maxDecimals?: number; placeholder?: string; constraintError?: string | null;
  /** null means a route-aware maximum must be resolved before use. */
  maxAmount?: string | null; onMax?: () => void | Promise<void>; maxPending?: boolean;
  tokenSelector?: ReactNode;
};

/** One input for Trade, Earn, Borrow and Move. Shortcuts never round-trip
 * through USD; native-token maxima remain owned by the route/gas planner. */
export function AmountField({ value, onChange, symbol, label, hint, balance, balanceState,
  allowAll = false, allowZero = false, showPercentages = true, showMax = true,
  showUsdValue = true, showUnitPrice = false, compact = false, disabled = false,
  maxDecimals = 18, placeholder = '0.00', constraintError, maxAmount, onMax,
  maxPending = false, tokenSelector,
}: AmountFieldProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [maxError, setMaxError] = useState('');
  useEffect(() => { setHydrated(true); }, []);
  useEffect(() => { setTouched(false); setMaxError(''); }, [symbol]);
  const quote = useUsdPrices();
  const key = priceKeyForSymbol(symbol);
  const timestamp = key ? quote.updatedAts?.[key] ?? quote.updatedAt : null;
  const candidate = key ? quote.prices[key] : undefined;
  const now = Date.now();
  const price = typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
    && typeof timestamp === 'number' && timestamp > 0 && timestamp <= now + 30_000
    && now - timestamp <= ASSET_PRICE_MAX_AGE_MS ? candidate : undefined;
  const worth = value.trim() && !decimalInputError(value, maxDecimals, { allowAll, allowZero })
    ? usdValueForDecimal(value, price) : null;
  // An explicit unavailable state always wins over a legacy balance prop.
  const available = balanceState ? balanceState.status === 'ready' ? balanceState.amount ?? null : null : balance;
  const hasBalance = Boolean(available && positiveDecimal(available, maxDecimals));
  const maximum = maxAmount === null ? null : maxAmount ?? available;
  const hasMaximum = Boolean(maximum && positiveDecimal(maximum, maxDecimals));
  const exceedsBalance = Boolean(available && value && compareExactDecimals(value, available, maxDecimals) === 1);
  const error = decimalInputError(value, maxDecimals, { allowAll, allowZero }) ?? constraintError
    ?? (exceedsBalance ? 'Amount exceeds your available balance.' : null)
    ?? (touched && !value && !allowZero ? 'Enter an amount.' : null);
  const showBalance = balanceState?.status !== 'disconnected' && (balance !== undefined || balanceState !== undefined);
  const canUseMax = allowAll ? hasBalance : hasMaximum || (maxAmount === null && hasBalance);
  const hasShortcuts = showPercentages && hasBalance || showMax && canUseMax;
  const isMax = allowAll ? value.toLowerCase() === 'all' : Boolean(maximum && hasMaximum && compareExactDecimals(value, maximum, maxDecimals) === 0);
  const describedBy = [hint && `${id}-hint`, showBalance && `${id}-balance`, error && `${id}-error`, maxError && `${id}-max-error`].filter(Boolean).join(' ') || undefined;
  const inactive = disabled || !hydrated;
  const change = (next: string) => { setMaxError(''); onChange(next); };
  const chooseMax = async () => {
    haptic('selection'); setMaxError('');
    if (allowAll) { change('all'); return; }
    if (maxAmount === null) {
      try { await onMax?.(); } catch { setMaxError('The spendable maximum could not be checked. Try again.'); }
      return;
    }
    const next = maximum ? calculateFractionDecimal(maximum, 100, maxDecimals) : null;
    if (next) change(next);
  };
  return <div className={styles.field} data-amount-field="unified" data-compact={compact || undefined}>
    <div className={styles.labelRow}>
      <label htmlFor={id}>{label}</label>
      <span className={styles.meta}>
        {hint && <span id={`${id}-hint`}>{hint}</span>}
        {showBalance && <span id={`${id}-balance`} title={balanceState?.reason ?? (available ? `${available} ${tokenSymbol(symbol)}` : 'Balance unavailable')}>
          Available: <strong><ValueOrSkeleton value={available != null ? `${formatExactDecimal(available, 8)} ${tokenSymbol(symbol)}` : '—'} width="sm"
            status={balanceState?.status === 'loading' || !balanceState && available == null ? 'loading' : 'unavailable'} label="Available balance" /></strong>
        </span>}
      </span>
    </div>
    <div className={`${styles.surface} amount-control`} data-invalid={Boolean(error) || undefined}>
      {hasShortcuts && <div role="group" aria-label={`${label} shortcuts`} className={styles.shortcuts}>
        {showPercentages && hasBalance && [25, 50, 75].map((percent) => <button key={percent} type="button" disabled={inactive} onClick={() => {
          haptic('selection'); const next = calculateFractionDecimal(available, percent, maxDecimals); if (next) change(next);
        }}><span>{percent}%</span></button>)}
        {showMax && canUseMax && <button type="button" onClick={() => void chooseMax()} disabled={inactive || maxPending || !allowAll && maxAmount === null && !onMax}
          aria-busy={maxPending || undefined} aria-label={allowAll ? 'Use all' : maxAmount === null ? 'Calculate 100% after gas reserve' : 'Use 100% of available balance'}
          title={maxAmount === null ? 'Reserve network fees before using the maximum' : undefined} data-selected={isMax || undefined}><span>{maxPending ? '…' : 'Max'}</span></button>}
      </div>}
      <div className={styles.entryRow}>
        <input id={id} value={value} onChange={(event) => change(allowAll && event.target.value.toLowerCase() === 'all' ? 'all' : event.target.value.replace(',', '.').slice(0, 100))}
          onBlur={() => setTouched(true)} disabled={inactive} inputMode="decimal" autoComplete="off" spellCheck={false} placeholder={placeholder}
          aria-label={`${label} in ${symbol}`} aria-describedby={describedBy} aria-invalid={Boolean(error)} aria-errormessage={error ? `${id}-error` : undefined} required={!allowZero}
          data-long-amount={value.length > 12 || undefined} />
        <div className={styles.token}>{tokenSelector ?? <span className={styles.tokenLabel} title={tokenSymbol(symbol)}><TokenIcon symbol={symbol} size={24} /><span>{tokenSymbol(symbol)}</span></span>}</div>
      </div>
      {showUsdValue && <div className={styles.usd} data-amount-usd>
        <span>{!value.trim() ? '—' : worth !== null ? `≈ ${formatUsd(worth)}` : <ValueOrSkeleton value="—" width="sm" status={quote.status === 'loading' ? 'loading' : 'unavailable'} label="USD value unavailable" />}</span>
        {showUnitPrice && price && <span>{formatUsdPrice(price)} / {tokenSymbol(symbol)}</span>}
      </div>}
    </div>
    {error && <p id={`${id}-error`} role="alert" className={styles.error}>{error}</p>}
    {maxError && <p id={`${id}-max-error`} role="status" className={styles.error}>{maxError}</p>}
  </div>;
}
