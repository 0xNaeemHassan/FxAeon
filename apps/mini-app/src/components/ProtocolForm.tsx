'use client';

import { useId, useState, type ReactNode } from 'react';
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
    <div className="grid grid-flow-col auto-cols-fr rounded-2xl border border-[var(--line)] bg-[rgba(0,0,0,.18)] p-1" role="radiogroup" aria-label={ariaLabel}>
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
            className={`glass-press min-h-11 rounded-xl px-2.5 py-2 text-center transition-colors ${
              active
                ? 'bg-[var(--mint-dim)] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(139,109,255,.26)]'
                : 'text-mut'
            }`}
          >
            <span className="block text-[12px] font-semibold">{option.label}</span>
            {option.sub && <span className="mt-0.5 block text-[9px] opacity-70">{option.sub}</span>}
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
      <label htmlFor={htmlFor} className="text-[10px] font-semibold uppercase tracking-[0.15em] text-mut">{children}</label>
      {hint && <span id={hintId} className="text-[10px] text-[var(--mut-2)]">{hint}</span>}
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
  const error = inputError ?? constraintError ?? (touched && !value ? 'Enter an amount.' : null);
  const normalise = (raw: string) => {
    if (allowAll && raw.toLowerCase() === 'all') return 'all';
    // Keep malformed pasted text visible and invalid. Stripping an exponent or
    // symbol can silently turn `1e6` into the very different value `16`.
    return raw.replace(',', '.').slice(0, 100);
  };

  const hasValidBalance = Boolean(balance && positiveDecimal(balance, maxDecimals));

  return (
    <div>
      <FieldLabel hint={hint ?? `Up to ${maxDecimals} decimals`} hintId={hintId} htmlFor={inputId}>{label}</FieldLabel>
      <div className={`group flex min-h-[76px] items-center gap-3 rounded-[20px] border bg-[rgba(255,255,255,.035)] px-4 transition-colors focus-within:border-[rgba(139,109,255,.5)] ${error ? 'border-[rgba(255,107,118,.55)]' : 'border-[var(--line)]'}`}>
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(normalise(event.target.value))}
          onBlur={() => setTouched(true)}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          aria-label={`${label} in ${symbol}`}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
          aria-errormessage={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          required
          className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-[27px] font-semibold tracking-[-0.04em] text-[var(--text)] outline-none placeholder:text-[var(--mut-2)]"
        />
        <span className="flex shrink-0 items-center gap-2 rounded-xl bg-[rgba(255,255,255,.055)] px-2.5 py-2 text-[12px] font-semibold">
          <TokenIcon symbol={symbol} size={22} /> {symbol}
        </span>
      </div>
      {(balance !== undefined || allowAll) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-mut">
          <div className="flex min-w-0 items-center gap-1 truncate">
            {balance !== undefined && (
              <span className="truncate" title={balance ?? 'Balance unavailable'}>
                Available: <span className="font-semibold text-[var(--text)]">{balance ? formatExactDecimal(balance, 4) : 'unavailable'}</span>
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
                className="min-h-7 rounded-lg border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[10.5px] font-semibold text-mut transition-colors hover:border-[var(--mint)]/40 hover:bg-[var(--mint-dim)] hover:text-mint"
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
                className="min-h-7 rounded-lg bg-[var(--mint-dim)] px-2.5 py-0.5 text-[10.5px] font-bold text-mint transition-colors hover:brightness-110"
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
                className="min-h-7 rounded-lg bg-[var(--mint-dim)] px-2.5 py-0.5 text-[10.5px] font-bold text-mint transition-colors hover:brightness-110"
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
  return (
    <div>
      <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={(event) => {
            haptic('selection');
            onChange(event.target.value as T);
          }}
          className="min-h-14 w-full appearance-none rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 pr-11 text-[14px] font-semibold text-[var(--text)] outline-none transition-colors focus:border-[rgba(139,109,255,.5)]"
        >
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-mut" />
      </div>
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
      <div className="rounded-[20px] border border-[var(--line)] bg-[rgba(255,255,255,.03)] p-4">
        <div className="mb-4 flex items-end justify-between">
          <span className="text-display text-[30px] font-semibold text-gradient">{value.toFixed(value % 1 ? 1 : 0)}{suffix}</span>
          <span className="rounded-lg bg-[var(--mint-dim)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-mint">Live risk bounds</span>
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
      className="glass-press flex w-full items-center gap-3 rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,.03)] p-3.5 text-left"
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
    <div className="flex gap-2.5 rounded-2xl bg-[rgba(139,109,255,.08)] p-3 text-[11px] leading-relaxed text-mut">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-mint" /> {children}
    </div>
  );
}
