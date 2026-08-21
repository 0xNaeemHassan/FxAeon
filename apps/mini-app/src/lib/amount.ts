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
