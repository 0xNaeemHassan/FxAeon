/**
 * Exact, UI-side decimal validation.
 *
 * Financial inputs must never pass through Number/parseFloat: large values can
 * overflow and tiny values can underflow even though the exact string is still
 * sent to the API. Keep the value as text and enforce the token's on-chain
 * precision before enabling a review.
 */
export function positiveDecimal(value: string, maxDecimals: number): string | null {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 35) return null;
  if (!value || value.length > 100) return null;
  const pattern = maxDecimals === 0
    ? /^\d+$/
    : new RegExp(`^(?:\\d+(?:\\.\\d{1,${maxDecimals}})?|\\.\\d{1,${maxDecimals}})$`);
  if (!pattern.test(value)) return null;
  return /[1-9]/.test(value) ? value : null;
}

/** Convert an already-validated plain decimal to exact token units. */
export function decimalToUnits(value: string, decimals: number): bigint | null {
  const valid = positiveDecimal(value, decimals);
  if (!valid) return null;
  const [integerRaw, fractionRaw = ''] = valid.split('.');
  const integer = integerRaw || '0';
  const fraction = fractionRaw.padEnd(decimals, '0');
  try {
    return BigInt(integer) * 10n ** BigInt(decimals) + BigInt(fraction || '0');
  } catch {
    return null;
  }
}

export function decimalInputError(
  value: string,
  maxDecimals: number,
  options: { allowAll?: boolean; allowZero?: boolean } = {}
): string | null {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 35) {
    return 'This asset has an invalid precision configuration.';
  }
  if (!value || (options.allowAll && value.toLowerCase() === 'all')) return null;
  if (value.length > 100 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    return 'Enter a plain decimal number.';
  }
  const fraction = value.split('.')[1] ?? '';
  if (fraction.length > maxDecimals) {
    return `${maxDecimals}-decimal precision maximum for this asset.`;
  }
  if (value.endsWith('.')) return 'Finish the decimal amount.';
  if (!options.allowZero && !/[1-9]/.test(value)) return 'Enter an amount greater than zero.';
  return null;
}

/** Normalize a pasted amount only under an explicit decimal separator policy.
 * Grouped values such as `1,000` are rejected because their meaning is ambiguous. */
export function normalizeAmountInput(
  input: string,
  policy: 'dot-decimal' | 'comma-decimal' = 'dot-decimal',
): string | null {
  const value = input.trim();
  if (value.length > 100) return null;
  if (policy === 'dot-decimal') return value.includes(',') ? null : value;
  if (value.includes('.') || (value.match(/,/g)?.length ?? 0) > 1) return null;
  if (/^\d{1,3}(?:,\d{3})+$/.test(value)) return null;
  return value.replace(',', '.');
}

/**
 * Format an API decimal without first coercing it to a JavaScript number.
 * This keeps balances above Number.MAX_SAFE_INTEGER and 18-decimal values
 * honest while still giving compact, grouped UI copy.
 */
export function formatExactDecimal(value: string, maxFractionDigits = 4): string {
  if (!Number.isInteger(maxFractionDigits) || maxFractionDigits < 0 || maxFractionDigits > 35) {
    return value;
  }

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, integer, fraction = ''] = match;
  const coefficient = BigInt(`${integer}${fraction}`);
  const trim = Math.max(0, fraction.length - maxFractionDigits);
  const divisor = 10n ** BigInt(trim);
  const rounded = trim > 0
    ? coefficient / divisor + ((coefficient % divisor) * 2n >= divisor ? 1n : 0n)
    : coefficient;
  const scale = Math.min(fraction.length, maxFractionDigits);
  const padded = rounded.toString().padStart(scale + 1, '0');
  const roundedInteger = scale === 0 ? padded : padded.slice(0, -scale);
  const roundedFraction = scale === 0 ? '' : padded.slice(-scale).replace(/0+$/, '');
  const grouped = roundedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const isZero = rounded === 0n;
  return `${sign && !isZero ? '-' : ''}${grouped}${roundedFraction ? `.${roundedFraction}` : ''}`;
}

/** Smallest amount spelled out; anything above zero but below it reads as "<0.000001". */
export const DISPLAY_DUST = '0.000001';

/**
 * Display copy for an exact token amount: grouped, at most `significant`
 * significant digits (whole numbers always kept, two decimals once an amount
 * reaches 1,000), truncated toward zero so a shown balance never exceeds the
 * exact one. Callers add direction signs; the input's own sign is kept.
 */
export function formatSignificantDecimal(value: string, significant = 5): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || !Number.isInteger(significant) || significant < 1 || significant > 30) return value;
  const [, sign, rawInteger, rawFraction = ''] = match;
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.replace(/0+$/, '');
  if (integer === '0' && fraction === '') return '0';
  if (integer === '0') {
    const leadingZeros = /^0*/.exec(fraction)![0].length;
    // DISPLAY_DUST itself has one zero fewer than anything below it.
    if (leadingZeros >= DISPLAY_DUST.length - 2) return `<${DISPLAY_DUST}`;
    const kept = fraction.slice(0, leadingZeros + significant).replace(/0+$/, '');
    return `${sign}0.${kept}`;
  }
  const fractionDigits = Math.max(integer.length >= 4 ? 2 : 0, significant - integer.length);
  const kept = fraction.slice(0, fractionDigits).replace(/0+$/, '');
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${kept ? `.${kept}` : ''}`;
}

/**
 * Thousands separators for an exact unsigned decimal string, for display only.
 * The fraction is left untouched, and anything else is returned as is.
 */
export function groupDigits(value: string): string {
  const match = /^(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  return `${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[2] ?? ''}`;
}

/** Compare two unsigned decimal strings at a fixed on-chain precision. */
export function compareExactDecimals(
  left: string,
  right: string,
  maxDecimals: number
): -1 | 0 | 1 | null {
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 35) return null;
  const parse = (value: string): bigint | null => {
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || value.endsWith('.')) return null;
    const [integer = '0', fraction = ''] = value.split('.');
    if (fraction.length > maxDecimals) return null;
    return BigInt(`${integer || '0'}${fraction.padEnd(maxDecimals, '0')}`);
  };
  const a = parse(left);
  const b = parse(right);
  if (a === null || b === null) return null;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Calculate an exact fractional percentage of a decimal balance (e.g. 25%, 50%, 75%, 100%).
 * Uses BigInt units to ensure zero float-precision corruption.
 */
export function calculateFractionDecimal(
  balance: string | null | undefined,
  percent: number,
  maxDecimals = 18
): string {
  if (!balance || !Number.isFinite(percent) || percent <= 0) return '';
  const cleanBalance = balance.trim();
  const valid = positiveDecimal(cleanBalance, maxDecimals);
  if (!valid) return '';

  if (percent >= 100) return valid;

  const units = decimalToUnits(valid, maxDecimals);
  if (units === null) return '';

  const fractionUnits = (units * BigInt(Math.round(percent))) / 100n;
  if (fractionUnits === 0n) return '0';

  const padded = fractionUnits.toString().padStart(maxDecimals + 1, '0');
  const integer = padded.slice(0, -maxDecimals) || '0';
  const fraction = padded.slice(-maxDecimals).replace(/0+$/, '');

  return fraction ? `${integer}.${fraction}` : integer;
}
