'use client';

import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import { haptic } from '@/lib/telegram';
import { calculateFractionDecimal, decimalInputError, formatExactDecimal, positiveDecimal } from '@/lib/amount';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; sub?: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented grid grid-flow-col auto-cols-fr p-1" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
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
            <span className="block text-[13px] font-semibold">{option.label}</span>
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
      <div className={`field-control flex min-h-[52px] items-center gap-2 px-4 ${error ? 'field-error' : ''}`}>
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
          className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-[16px] font-semibold outline-none"
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
  allowAll = false,
  allowZero = false,
  showPercentages = true,
  maxDecimals = 18,
  placeholder = '0.00',
  constraintError,
}: {
  value: string;
  onChange: (value: string) => void;
  symbol: string;
  label: string;
  hint?: string;
  balance?: string | null;
  allowAll?: boolean;
  allowZero?: boolean;
  showPercentages?: boolean;
  maxDecimals?: number;
  placeholder?: string;
  constraintError?: string | null;
}) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const [touched, setTouched] = useState(false);
  const inputError = decimalInputError(value, maxDecimals, { allowAll, allowZero });
  const error = inputError ?? constraintError ?? (touched && !value && !allowZero ? 'Enter an amount.' : null);
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const normalise = (raw: string) => {
    if (allowAll && raw.toLowerCase() === 'all') return 'all';
    // Keep malformed pasted text visible and invalid. Stripping an exponent or
    // symbol can silently turn `1e6` into the very different value `16`.
    return raw.replace(',', '.').slice(0, 100);
  };

  const hasValidBalance = Boolean(balance && positiveDecimal(balance, maxDecimals));

  return (
    <div>
      <FieldLabel hint={hint} hintId={hintId} htmlFor={inputId}>{label}</FieldLabel>
      <div className={`amount-control group flex min-h-[76px] items-center gap-3 px-4 ${error ? 'field-error' : ''}`}>
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
          className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-[25px] font-semibold text-[var(--text)] outline-none placeholder:text-[var(--mut-2)]"
        />
        <span className="token-pill flex shrink-0 items-center gap-2 px-2.5 py-2 text-[12px] font-semibold">
          <TokenIcon symbol={symbol} size={22} /> {symbol}
        </span>
      </div>
      {(balance !== undefined || allowAll) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-mut">
          <div className="flex min-w-0 items-center gap-1 truncate">
            {balance !== undefined && (
              <span className="truncate" title={balance ?? 'Balance unavailable'}>
                Balance: <span className="font-semibold text-[var(--text)]">{balance ? formatExactDecimal(balance, 4) : 'unavailable'}</span>
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
                  const fraction = calculateFractionDecimal(balance, pct, maxDecimals);
                  if (fraction) onChange(fraction);
                }}
                className="fraction-button min-h-11 min-w-11 px-2 py-0.5 text-[10.5px] font-semibold text-mut"
              >
                {pct}%
              </button>
            ))}
            {allowAll ? (
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
            ) : showPercentages && hasValidBalance ? (
              <button
                type="button"
                onClick={() => {
                  haptic('selection');
                  const fraction = calculateFractionDecimal(balance, 100, maxDecimals);
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
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  label: string;
}) {
  const selectId = useId();
  const labelId = `${selectId}-label`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const selectedIndex = Math.max(0, options.indexOf(value));
    window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, options, value]);

  const choose = (next: T) => {
    haptic('selection');
    onChange(next);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveFocus = (current: number, direction: 'next' | 'previous' | 'first' | 'last') => {
    const next = direction === 'first'
      ? 0
      : direction === 'last'
        ? options.length - 1
        : (current + (direction === 'next' ? 1 : -1) + options.length) % options.length;
    optionRefs.current[next]?.focus();
  };

  return (
    <div>
      <span id={labelId} className="mb-2 block text-[12px] font-medium text-mut">{label}</span>
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${selectId}-menu`}
        aria-labelledby={labelId}
        onClick={() => setOpen((current) => !current)}
        className="field-control glass-press flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left text-[15px] font-semibold text-[var(--text)] outline-none"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <TokenIcon symbol={value} size={26} />
          <span className="truncate">{value}</span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-mut transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-3 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) { setOpen(false); triggerRef.current?.focus(); } }}
        >
          <div
            id={`${selectId}-menu`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            className="w-full max-w-[430px] overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--bg-raised)] shadow-[0_24px_80px_rgba(0,0,0,.55)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3.5">
              <div>
                <p className="text-[14px] font-semibold">{label}</p>
                <p className="mt-0.5 text-[11px] text-mut">Choose an asset</p>
              </div>
              <button type="button" aria-label="Close asset picker" onClick={() => { setOpen(false); triggerRef.current?.focus(); }} className="glass-press flex min-h-11 min-w-11 items-center justify-center rounded-lg text-mut hover:text-[var(--text)]">×</button>
            </div>
            <div role="listbox" aria-label={`${label} options`} className="max-h-[min(64dvh,480px)] overflow-y-auto p-2">
              {options.map((option, index) => {
                const active = option === value;
                return (
                  <button
                    key={option}
                    ref={(element) => { optionRefs.current[index] = element; }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-label={`${option}${active ? ' selected' : ''}`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => choose(option)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(index, 'next'); }
                      else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(index, 'previous'); }
                      else if (event.key === 'Home') { event.preventDefault(); moveFocus(index, 'first'); }
                      else if (event.key === 'End') { event.preventDefault(); moveFocus(index, 'last'); }
                      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(option); }
                    }}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors ${active ? 'bg-[var(--mint-dim)] text-[var(--text)]' : 'text-mut hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`}
                  >
                    <TokenIcon symbol={option} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold">{option === 'fxUSDBasePool' ? 'fxUSD base pool' : option}</span>
                      <span className="mt-0.5 block text-[10.5px] text-mut">{active ? 'Selected asset' : 'Available asset'}</span>
                    </span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${active ? 'border-[var(--mint)] bg-[var(--mint)] text-white' : 'border-[var(--line-strong)]'}`} aria-hidden="true">{active ? '✓' : ''}</span>
                  </button>
                );
              })}
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
  const errorId = `${inputId}-error`;
  const invalid = Boolean(error);
  return (
    <div>
      <FieldLabel htmlFor={inputId} hint={`${min}× – ${max}×`}>{label}</FieldLabel>
      <div className={`range-control p-3 ${invalid ? 'field-error' : ''}`}>
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
      </div>
      {error && <p id={errorId} role="alert" className="mt-1.5 px-1 text-[11px] leading-relaxed text-danger">{error}</p>}
    </div>
  );
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
