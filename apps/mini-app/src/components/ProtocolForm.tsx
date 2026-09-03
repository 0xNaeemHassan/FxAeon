'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Info, Search } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import { useUsdPrices } from '@/components/PriceProvider';
import { haptic } from '@/lib/telegram';
import { calculateFractionDecimal, compareExactDecimals, decimalInputError, formatExactDecimal, positiveDecimal } from '@/lib/amount';
import { readWalletBalances } from '@/lib/fx';
import { formatUsdCents } from '@/lib/positionValuation';
import { formatUsd, formatUsdPrice, priceKeyForSymbol, usdValueForDecimal, type UsdPriceMap } from '@/lib/prices';
import styles from '@/components/trade-surfaces.module.css';
import {
  balanceMapForResult,
  createWalletBalanceReader,
  tokenBalanceFor,
  usdCentsForTokenBalance,
  type TokenBalanceMap,
  type TokenBalanceView,
} from '@/components/wallet-balance-cache';

export { tokenBalanceFor } from '@/components/wallet-balance-cache';
export type { TokenBalanceMap, TokenBalanceView } from '@/components/wallet-balance-cache';

export type WalletTokenBalanceSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  balances: TokenBalanceMap;
  reason?: string;
  refresh: (force?: boolean) => Promise<void>;
};

const EMPTY_TOKEN_BALANCES: TokenBalanceMap = {};
const WALLET_BALANCE_REFRESH_MS = 20_000;
const walletBalanceReader = createWalletBalanceReader(readWalletBalances);

/**
 * Shared, short-lived wallet balance read for protocol forms. Reads are
 * deduplicated by address and deliberately only use the Ethereum reader that
 * backs the existing FX token registry; other target chains stay honest as
 * unavailable rather than displaying a misleading zero. `identityChainId`
 * can invalidate the view on a wallet network change while retaining a
 * different target chain for read-only previews.
 */
export function useWalletTokenBalances(walletAddress?: string, chainId?: number, identityChainId = chainId): WalletTokenBalanceSnapshot {
  const [snapshot, setSnapshot] = useState<WalletTokenBalanceSnapshot & { identity: string }>({ status: 'idle', balances: EMPTY_TOKEN_BALANCES, identity: 'none', refresh: async () => {} });
  const requestRef = useRef(0);
  const address = walletAddress?.trim();
  const identity = `${address?.toLowerCase() ?? 'none'}:${identityChainId ?? 'none'}`;

  const refresh = useCallback(async (force = true) => {
    if (!address || chainId !== 1) return;
    if (!force && walletBalanceReader.isPending(address)) return;
    const requestId = ++requestRef.current;
    setSnapshot({ status: 'loading', balances: EMPTY_TOKEN_BALANCES, identity, refresh });
    try {
      const result = await walletBalanceReader.read(address, force);
      if (requestRef.current !== requestId) return;
      setSnapshot({ status: 'ready', balances: balanceMapForResult(result), identity, refresh });
    } catch {
      if (requestRef.current !== requestId) return;
      setSnapshot({ status: 'unavailable', balances: EMPTY_TOKEN_BALANCES, reason: 'Available balances are temporarily unavailable.', identity, refresh });
    }
  }, [address, chainId, identity]);

  const initialSnapshot = useMemo<WalletTokenBalanceSnapshot & { identity: string }>(() => {
    if (!address) return { status: 'idle', balances: EMPTY_TOKEN_BALANCES, identity, refresh };
    if (chainId !== 1) return {
      status: 'unavailable',
      balances: EMPTY_TOKEN_BALANCES,
      reason: 'Switch to Ethereum to view available balances.',
      identity,
      refresh,
    };
    return { status: 'loading', balances: EMPTY_TOKEN_BALANCES, identity, refresh };
  }, [address, chainId, identity, refresh]);

  useEffect(() => {
    if (!address) {
      requestRef.current += 1;
      setSnapshot(initialSnapshot);
      return;
    }
    if (chainId !== 1) {
      requestRef.current += 1;
      setSnapshot(initialSnapshot);
      return;
    }

    let active = true;
    const requestId = ++requestRef.current;
    setSnapshot(initialSnapshot);
    void walletBalanceReader.read(address).then((result) => {
      if (!active || requestRef.current !== requestId) return;
      setSnapshot({ status: 'ready', balances: balanceMapForResult(result), identity, refresh });
    }).catch(() => {
      if (!active || requestRef.current !== requestId) return;
      setSnapshot({ status: 'unavailable', balances: EMPTY_TOKEN_BALANCES, reason: 'Available balances are temporarily unavailable.', identity, refresh });
    });

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refresh(false);
    };
    const interval = window.setInterval(refreshIfVisible, WALLET_BALANCE_REFRESH_MS);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      active = false;
      requestRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [address, chainId, identity, identityChainId, initialSnapshot, refresh]);

  return snapshot.identity === identity ? snapshot : initialSnapshot;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  tone = 'default',
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; sub?: string; ariaLabel?: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  tone?: 'default' | 'sides';
}) {
  return (
    <div className={`${styles.formSegmented} segmented ${tone === 'sides' ? 'segmented-sides' : ''} grid grid-flow-col auto-cols-fr p-1`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-label={option.ariaLabel ?? option.label}
            aria-checked={active}
            data-value={option.value}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              haptic('selection');
              onChange(option.value);
            }}
            onKeyDown={(event) => {
              const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const current = options.findIndex((item) => item.value === option.value);
              const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
              const next = event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (current + (backwards ? -1 : 1) + options.length) % options.length;
              onChange(options[next].value);
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
              buttons?.[next]?.focus();
              haptic('selection');
            }}
            className={`segmented-option glass-press min-h-11 px-2 py-2 text-center transition-colors ${
              active
                ? 'segmented-option-active text-[var(--text)]'
                : 'text-mut'
            }`}
          >
            {option.icon ? (
              <span className="flex items-center justify-center gap-2">
                <span className="market-option-icon" aria-hidden="true">{option.icon}</span>
                <span className="text-[13px] font-semibold">{option.label}</span>
              </span>
            ) : <span className="block text-[13px] font-semibold">{option.label}</span>}
            {option.sub && <span className="mt-0.5 block text-[11px] opacity-70">{option.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function FieldLabel({
  children,
  hint,
  htmlFor,
  hintId,
}: {
  children: ReactNode;
  hint?: string;
  htmlFor?: string;
  hintId?: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-mut">{children}</label>
      {hint && <span id={hintId} className="text-[11px] text-[var(--mut-2)]">{hint}</span>}
    </div>
  );
}

export function SlippageField({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  max: number;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [touched, setTouched] = useState(false);
  const numeric = Number(value);
  const error = value
    ? (!Number.isFinite(numeric) || numeric <= 0 || numeric > max
        ? `Enter a slippage tolerance greater than 0% and no more than ${max}%.`
        : null)
    : touched
      ? 'Enter a slippage tolerance.'
      : null;

  return (
    <div>
      <FieldLabel htmlFor={inputId} hint={`Max ${max}%`}>Slippage</FieldLabel>
      <div className={`${styles.formField} field-control flex min-h-[52px] items-center gap-2 px-4 ${error ? 'field-error' : ''}`}>
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(',', '.').slice(0, 32))}
          onBlur={() => setTouched(true)}
          inputMode="decimal"
          autoComplete="off"
          aria-label="Slippage tolerance percentage"
          aria-invalid={Boolean(error)}
          aria-errormessage={error ? errorId : undefined}
          className="min-h-11 min-w-0 flex-1 bg-transparent font-sans tabular-nums text-[16px] font-semibold outline-none"
        />
        <span className="text-[12px] text-mut">%</span>
      </div>
      {error && <p id={errorId} role="alert" className="mt-1.5 px-1 text-[11px] leading-relaxed text-danger">{error}</p>}
    </div>
  );
}

export function AmountField({
  value,
  onChange,
  symbol,
  label,
  hint,
  balance,
  balanceState,
  allowAll = false,
  allowZero = false,
  showPercentages = true,
  showMax = true,
  maxDecimals = 18,
  placeholder = '0.00',
  constraintError,
  tokenSelector,
}: {
  value: string;
  onChange: (value: string) => void;
  symbol: string;
  label: string;
  hint?: string;
  balance?: string | null;
  balanceState?: TokenBalanceView;
  allowAll?: boolean;
  allowZero?: boolean;
  showPercentages?: boolean;
  showMax?: boolean;
  maxDecimals?: number;
  placeholder?: string;
  constraintError?: string | null;
  tokenSelector?: ReactNode;
}) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const balanceId = `${inputId}-balance`;
  const [touched, setTouched] = useState(false);
  const { prices } = useUsdPrices();
  const priceKey = priceKeyForSymbol(symbol);
  const usdPrice = priceKey ? prices[priceKey] : undefined;
  const usdValue = usdValueForDecimal(value, usdPrice);
  const inputError = decimalInputError(value, maxDecimals, { allowAll, allowZero });
  const error = inputError ?? constraintError ?? (touched && !value && !allowZero ? 'Enter an amount.' : null);
  const describedBy = [hint ? hintId : null, balance !== undefined || balanceState !== undefined ? balanceId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const normalise = (raw: string) => {
    if (allowAll && raw.toLowerCase() === 'all') return 'all';
    // Keep malformed pasted text visible and invalid. Stripping an exponent or
    // symbol can silently turn `1e6` into the very different value `16`.
    return raw.replace(',', '.').slice(0, 100);
  };

  const availableBalance = balanceState?.status === 'ready' ? balanceState.amount ?? null : balance;
  const hasValidBalance = Boolean(availableBalance && positiveDecimal(availableBalance, maxDecimals));
  const insufficientBalance = Boolean(
    balanceState?.status === 'ready'
      && availableBalance
      && value
      && compareExactDecimals(value, availableBalance, maxDecimals) === 1,
  );

  return (
    <div>
      <FieldLabel hint={hint} hintId={hintId} htmlFor={inputId}>{label}</FieldLabel>
      <div className={`${styles.amountField} amount-control group flex min-h-[76px] items-center gap-3 px-4 ${error ? 'field-error' : ''}`}>
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(normalise(event.target.value))}
          onBlur={() => setTouched(true)}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          aria-label={`${label} in ${symbol}`}
          aria-describedby={describedBy}
          aria-errormessage={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          required={!allowZero}
          className={`${styles.amountInput} min-h-11 min-w-0 flex-1 bg-transparent text-[25px] font-semibold text-[var(--text)] outline-none placeholder:text-[var(--mut-2)]`}
        />
        {tokenSelector ?? <span className="token-pill flex shrink-0 items-center gap-2 px-2.5 py-2 text-[12px] font-semibold">
          <TokenIcon symbol={symbol} size={22} /> {symbol}
        </span>}
      </div>
      {usdPrice && (
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] text-mut" aria-live="polite">
          <span>{usdValue === null ? 'Enter an amount for USD value' : `≈ ${formatUsd(usdValue)}`}</span>
          <span>{formatUsdPrice(usdPrice)} / {displayTokenSymbol(symbol)}</span>
        </div>
      )}
      {(balance !== undefined || balanceState !== undefined || allowAll) && (
        <div id={balanceId} className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-mut">
          <div className="flex min-w-0 items-center gap-1 truncate">
            {(balance !== undefined || balanceState !== undefined) && (
              <span className="truncate" title={balanceState?.reason ?? (availableBalance ?? 'Balance unavailable')}>
                Available: <span className="font-semibold text-[var(--text)]">
                  {balanceState?.status === 'loading'
                    ? `loading… ${displayTokenSymbol(symbol)}`
                    : balanceState?.status === 'disconnected'
                      ? `connect wallet · ${displayTokenSymbol(symbol)}`
                    : balanceState?.status === 'unavailable'
                      ? `unavailable · ${displayTokenSymbol(symbol)}`
                      : availableBalance
                        ? `${formatExactDecimal(availableBalance, 4)} ${displayTokenSymbol(symbol)}`
                        : `unavailable · ${displayTokenSymbol(symbol)}`}
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {showPercentages && hasValidBalance && [25, 50, 75].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => {
                  haptic('selection');
                  const fraction = calculateFractionDecimal(availableBalance, pct, maxDecimals);
                  if (fraction) onChange(fraction);
                }}
                className="fraction-button min-h-11 min-w-11 px-2 py-0.5 text-[10.5px] font-semibold text-mut"
              >
                {pct}%
              </button>
            ))}
            {showMax && allowAll ? (
              <button
                type="button"
                onClick={() => {
                  haptic('selection');
                  onChange('all');
                }}
                className="fraction-button fraction-button-active min-h-11 min-w-11 px-2.5 py-0.5 text-[10.5px] font-bold text-mint"
              >
                MAX
              </button>
            ) : showMax && showPercentages && hasValidBalance ? (
              <button
                type="button"
                onClick={() => {
                  haptic('selection');
                  const fraction = calculateFractionDecimal(availableBalance, 100, maxDecimals);
                  if (fraction) onChange(fraction);
                }}
                className="fraction-button fraction-button-active min-h-11 min-w-11 px-2.5 py-0.5 text-[10.5px] font-bold text-mint"
              >
                MAX
              </button>
            ) : null}
          </div>
        </div>
      )}
      {insufficientBalance && (
        <p role="status" aria-live="polite" className="mt-1.5 px-1 text-[11px] leading-relaxed text-danger">
          Amount exceeds your available balance. Review is still available, but this action cannot be funded as entered.
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 px-1 text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TokenSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  compact = false,
  balances,
  balanceStatus,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
  balances?: TokenBalanceMap;
  balanceStatus?: Exclude<WalletTokenBalanceSnapshot['status'], 'idle'> | 'disconnected';
}) {
  const selectId = useId();
  const labelId = `${selectId}-label`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { prices } = useUsdPrices();
  const pickerBalances = balances;
  const pickerStatus = balanceStatus;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closingRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const filteredOptions = useMemo(() => {
    const normalised = query.trim().toLowerCase();
    if (!normalised) return [...options];
    return options.filter((option) => `${displayTokenSymbol(option)} ${displayTokenName(option)}`.toLowerCase().includes(normalised));
  }, [options, query]);

  const closePicker = () => {
    closingRef.current = true;
    restoreFocusRef.current = true;
    setQuery('');
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    closingRef.current = false;
    restoreFocusRef.current = false;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const selectedIndex = Math.max(0, filteredOptions.indexOf(value));
    window.requestAnimationFrame(() => {
      if (closingRef.current || !dialogRef.current) return;
      if (options.length > 4) searchRef.current?.focus();
      else optionRefs.current[selectedIndex]?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePicker();
      } else if (event.key === 'Tab' && dialogRef.current) {
        const dialog = dialogRef.current;
        const focusable = getDialogFocusable(dialog);
        if (!dialog.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? focusable[focusable.length - 1] : focusable[0])?.focus();
        } else {
          trapDialogFocus(event, dialog);
        }
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (closingRef.current || !dialog || dialog.contains(event.target as Node)) return;
      getDialogFocusable(dialog)[0]?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (restoreFocusRef.current) {
        restoreFocusRef.current = false;
        closingRef.current = false;
        trigger?.focus({ preventScroll: true });
      }
    };
    // Picker lifecycle listeners intentionally only follow open/close. Search
    // and option changes must not restart the initial-focus routine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (next: T) => {
    haptic('selection');
    onChange(next);
    closePicker();
  };

  const moveFocus = (current: number, direction: 'next' | 'previous' | 'first' | 'last') => {
    const next = direction === 'first'
      ? 0
      : direction === 'last'
        ? filteredOptions.length - 1
        : (current + (direction === 'next' ? 1 : -1) + filteredOptions.length) % filteredOptions.length;
    optionRefs.current[next]?.focus();
  };

  return (
    <div className={compact ? styles.compactTokenSelect : undefined}>
      <span id={labelId} className={compact ? 'sr-only' : 'mb-2 block text-[12px] font-medium text-mut'}>{label}</span>
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${selectId}-menu`}
        aria-labelledby={labelId}
        onClick={() => setOpen((current) => {
          if (!current) setQuery('');
          return !current;
        })}
        className={`${compact ? '' : 'field-control'} glass-press flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left text-[15px] font-semibold text-[var(--text)] outline-none`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <TokenIcon symbol={value} size={26} />
          <span className="truncate">{displayTokenSymbol(value)}</span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-mut transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          className={styles.tokenPickerBackdrop}
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closePicker(); }}
        >
          <div
            ref={dialogRef}
            id={`${selectId}-menu`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            className={styles.tokenPickerDialog}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.tokenPickerHeader}>
              <div>
                <p className={styles.tokenPickerTitle}>{label}</p>
                <p className={styles.tokenPickerSubtitle}>Choose an asset</p>
              </div>
              <button type="button" aria-label="Close asset picker" onClick={closePicker} className={`${styles.tokenPickerClose} glass-press`}>×</button>
            </div>
            {options.length > 4 && (
              <label className={styles.tokenPickerSearch}>
                <Search className="h-4 w-4 shrink-0 text-mut" aria-hidden="true" />
                <span className="sr-only">Search assets</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search assets"
                  className={styles.tokenPickerSearchInput}
                />
              </label>
            )}
            <div role="listbox" aria-label={`${label} options`} className={styles.tokenPickerList}>
                {filteredOptions.map((option, index) => {
                  const active = option === value;
                  const balanceId = `${selectId}-balance-${index}`;
                  const balanceUsdId = `${balanceId}-usd`;
                  const balance = tokenBalanceFor(pickerBalances ?? EMPTY_TOKEN_BALANCES, option)
                    ?? (pickerStatus ? { status: pickerStatus } : undefined);
                  return (
                  <button
                    key={option}
                    ref={(element) => { optionRefs.current[index] = element; }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-label={`${displayTokenSymbol(option)}${active ? ' selected' : ''}`}
                    aria-describedby={(pickerBalances || pickerStatus) ? `${balanceId} ${balanceUsdId}` : undefined}
                    tabIndex={active ? 0 : -1}
                    onClick={() => choose(option)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(index, 'next'); }
                      else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(index, 'previous'); }
                      else if (event.key === 'Home') { event.preventDefault(); moveFocus(index, 'first'); }
                      else if (event.key === 'End') { event.preventDefault(); moveFocus(index, 'last'); }
                      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(option); }
                    }}
                    className={`${styles.tokenPickerRow} ${active ? styles.tokenPickerRowActive : ''}`}
                  >
                    <TokenIcon symbol={option} size={30} />
                    <span className={styles.tokenPickerRowCopy}>
                      <span className={styles.tokenPickerSymbol}>{displayTokenSymbol(option)}</span>
                      <span className={styles.tokenPickerName}>{displayTokenName(option)}</span>
                    </span>
                    {(pickerBalances || pickerStatus) && (
                      <span className={styles.tokenPickerValue}>
                        <span id={balanceId} className={styles.tokenPickerBalance} title={balance?.amount ? `${balance.amount} ${displayTokenSymbol(option)}` : balance?.reason}>
                          {balance?.status === 'ready' && <span className="sr-only">Available: </span>}{optionBalanceLabel(balance, option)}
                        </span>
                        <span id={balanceUsdId} className={styles.tokenPickerBalanceUsd}>{optionBalanceUsdLabel(balance, option, prices)}</span>
                      </span>
                    )}
                    <span className={styles.tokenPickerCheckWrap}>
                      <span className={`${styles.tokenPickerCheck} ${active ? styles.tokenPickerCheckActive : ''}`} aria-hidden="true">{active ? '✓' : ''}</span>
                    </span>
                  </button>
                );
              })}
              {filteredOptions.length === 0 && (
                <div role="status" className="px-4 py-8 text-center">
                  <p className="text-[13px] font-semibold">No matching assets</p>
                  <p className="mt-1 text-[11px] text-mut">Try a symbol such as ETH, BTC, or USDC.</p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      <span className="sr-only" aria-live="polite">{label}: {value}</span>
    </div>
  );
}

export function RangeField({
  value,
  onChange,
  min,
  max,
  step = 0.1,
  label,
  suffix = '×',
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  suffix?: string;
}) {
  const rangeId = useId();
  const fill = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div>
      <FieldLabel htmlFor={rangeId} hint={`${min}${suffix} – ${max}${suffix}`}>{label}</FieldLabel>
      <div className="range-control p-4">
        <div className="mb-3 flex items-end justify-between">
          <span className="text-display text-[26px] font-semibold text-mint">{value.toFixed(value % 1 ? 1 : 0)}{suffix}</span>
          <span className="text-[11px] text-mut">{min}{suffix} to {max}{suffix}</span>
        </div>
        <input
          id={rangeId}
          type="range"
          className="lever"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            haptic('selection');
            onChange(Number(event.target.value));
          }}
          style={{ '--fill': `${fill}%` } as React.CSSProperties}
          aria-valuetext={`${value}${suffix}`}
        />
      </div>
    </div>
  );
}

/**
 * Leverage is bounded by the live pool debt-ratio configuration (with a
 * conservative fallback while RPC metadata is unavailable). The SDK remains
 * the final authority when it plans the reviewed route.
 */
export function LeverageField({
  value,
  onChange,
  label = 'Leverage',
  min = 0.1,
  max = 20,
  error,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  min?: number;
  max?: number;
  error?: string | null;
}) {
  const inputId = useId();
  const sliderId = `${inputId}-slider`;
  const errorId = `${inputId}-error`;
  const invalid = Boolean(error);
  const sliderValue = Math.min(max, Math.max(min, Number.isFinite(value) && value > 0 ? value : min));
  const fill = max === min ? 0 : ((sliderValue - min) / (max - min)) * 100;
  return (
    <div>
      <FieldLabel htmlFor={inputId} hint={`${min}× – ${max}×`}>{label}</FieldLabel>
      <div className={`${styles.rangeField} range-control p-3 ${invalid ? 'field-error' : ''}`}>
        <div className="flex items-center gap-3">
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step="0.1"
            value={Number.isFinite(value) ? value : ''}
            onChange={(event) => {
              if (!event.target.value) {
                onChange(0);
                return;
              }
              const next = Number(event.target.value);
              // Clamp an over-limit paste/keystroke immediately. Values below
              // the live minimum remain editable until blur so decimals can be
              // entered naturally, then the field is normalized below.
              onChange(Number.isFinite(next) ? Math.min(max, next) : 0);
            }}
            onBlur={() => {
              haptic('selection');
              if (Number.isFinite(value) && value > 0 && value < min) onChange(min);
            }}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            className="field-control min-h-[52px] min-w-0 flex-1 px-4 text-[20px] font-semibold outline-none"
          />
          <span className="text-display text-[22px] font-semibold text-mint" aria-hidden="true">×</span>
        </div>
        <div className="mt-2 border-t border-[var(--line)] pt-2">
          <input
            id={sliderId}
            type="range"
            className="lever"
            min={min}
            max={max}
            step="0.1"
            value={sliderValue}
            aria-label={`${label} slider`}
            aria-valuetext={`${sliderValue.toFixed(1)}×`}
            onChange={(event) => onChange(Number(event.target.value))}
            onPointerUp={() => haptic('selection')}
            style={{ '--fill': `${fill}%` } as React.CSSProperties}
          />
          <div className="flex justify-between px-1 text-[10px] font-medium text-mut" aria-hidden="true">
            <span>{min.toFixed(1)}×</span><span>{max.toFixed(1)}×</span>
          </div>
        </div>
      </div>
      {error && <p id={errorId} role="alert" className="mt-1.5 px-1 text-[11px] leading-relaxed text-danger">{error}</p>}
    </div>
  );
}

function displayTokenSymbol(symbol: string): string {
  if (symbol.toLowerCase() === 'usdc') return 'USDC';
  if (symbol === 'fxUSDBasePool' || symbol.toLowerCase() === 'fxusd base pool') return 'fxUSD base pool';
  return symbol;
}

function displayTokenName(symbol: string): string {
  const names: Record<string, string> = {
    ETH: 'Ethereum',
    WETH: 'Wrapped Ether',
    STETH: 'Lido Staked Ether',
    WSTETH: 'Wrapped staked Ether',
    BTC: 'Bitcoin',
    WBTC: 'Wrapped Bitcoin',
    USDC: 'USD Coin',
    USDT: 'Tether USD',
    FXUSD: 'f(x) USD',
    FXSAVE: 'f(x) Savings',
    FXUSDBASEPOOL: 'fxUSD base pool',
    FXN: 'f(x) Network',
    FRAX: 'Frax',
  };
  return names[symbol.replace(/\s+/g, '').toUpperCase()] ?? 'Protocol token';
}

function optionBalanceLabel(balance: TokenBalanceView | undefined, symbol: string): string {
  const display = displayTokenSymbol(symbol);
  if (balance?.status === 'disconnected') return 'Connect wallet';
  if (!balance || balance.status === 'unavailable') return 'Balance unavailable';
  if (balance.status === 'loading') return 'Loading balance…';
  if (balance.amount === undefined) return 'Balance unavailable';
  return `${formatExactDecimal(balance.amount, 4)} ${display}`;
}

function optionBalanceUsdLabel(balance: TokenBalanceView | undefined, symbol: string, prices: UsdPriceMap): string {
  if (balance?.status === 'disconnected') return 'To see balances';
  if (balance?.status === 'loading') return 'Loading value…';
  const cents = usdCentsForTokenBalance(balance, symbol, prices);
  if (cents === null) return 'USD unavailable';
  if (cents === 0n && /[1-9]/.test(balance?.amount ?? '')) return '≈ <$0.01';
  return `≈ ${formatUsdCents(cents)}`;
}

function getDialogFocusable(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
}

function trapDialogFocus(event: KeyboardEvent, dialog: HTMLElement): void {
  const focusable = getDialogFocusable(dialog);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function ToggleRow({
  checked,
  onChange,
  title,
  body,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic('selection');
        onChange(!checked);
      }}
      className="toggle-row glass-press flex w-full items-center gap-3 p-3.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[10.5px] leading-relaxed text-mut">{body}</span>
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-mint' : 'bg-[rgba(255,255,255,.12)]'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="info-note flex gap-2.5 p-3 text-[12px] leading-relaxed text-mut">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-mint" /> {children}
    </div>
  );
}
