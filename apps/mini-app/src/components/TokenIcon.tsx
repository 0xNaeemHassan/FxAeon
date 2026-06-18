'use client';

/**
 * Token / asset logos used across the Mini App.
 *
 * Every logo is an inline SVG (no external requests, no broken images, crisp at
 * any size). They are simplified, recognizable marks for the assets the product
 * actually touches:
 *   ETH, wstETH, WBTC, BTC, FXN, fxUSD, fxSAVE, FRAX (governance token, prev. FXS).
 *
 * For tokens without a dedicated mark we fall back to a clean gradient circle
 * with the first 1-3 letters of the symbol.
 */

export type TokenSymbol =
  | 'ETH'
  | 'wstETH'
  | 'stETH'
  | 'WBTC'
  | 'BTC'
  | 'FXN'
  | 'fxUSD'
  | 'fxSAVE'
  | 'FRAX'
  | 'USDC'
  | 'USDT'
  | string;

interface TokenIconProps {
  symbol: TokenSymbol;
  size?: number;
  className?: string;
}

const common = 'rounded-full object-contain';

export function TokenIcon({ symbol, size = 44, className = '' }: TokenIconProps) {
  const s = symbol.toUpperCase();
  const style = { width: size, height: size };

  // Ethereum diamond
  if (s === 'ETH' || s === 'WETH') {
    return (
      <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
        <circle cx="16" cy="16" r="16" fill="#627EEA" />
        <path d="M16 6l-7 11.5 7 3 7-3L16 6z" fill="white" fillOpacity="0.9" />
        <path d="M9 17.5L16 29l7-11.5-7 3-7-3z" fill="white" fillOpacity="0.6" />
      </svg>
    );
  }

  // Lido staked ETH (wstETH / stETH) — stylised Lido gradient circle
  if (s === 'WSTETH' || s === 'STETH') {
    return (
      <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
        <defs>
          <linearGradient id="wstethGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00A3FF" />
            <stop offset="100%" stopColor="#F0F" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="16" fill="url(#wstethGrad)" />
        <text x="16" y="20" textAnchor="middle" fill="white" fontSize="10" fontWeight="700" fontFamily="sans-serif">st</text>
      </svg>
    );
  }

  // Bitcoin
  if (s === 'WBTC' || s === 'BTC') {
    return (
      <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
        <circle cx="16" cy="16" r="16" fill="#F7931A" />
        <path
          d="M22.6 14.5c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.6 2.6c-.4-.1-.9-.2-1.3-.3l.7-2.6-1.6-.4-.7 2.7c-.3-.1-.7-.2-1-.2l.2-2.8-1.4-.2-.6 2.4s-.6-.2-.7-.2l-.1-2.6-1.5-.2-.3 2.6c-1.8-.5-3.3-.4-4.2 1.1-.7 1.2-.4 2.7.6 3.5-.4.2-.8.6-1 1.1-.5 1.5.1 3 1.9 3.6l-1.1 4.3 1.6.4.6-2.6c.4.1.9.2 1.3.3l-.6 2.6 1.6.4.7-2.7c.3.1.6.2 1 .2l-.2 2.8 1.4.2.6-2.4c.8.1 1.5.2 2.2.1 1.8-.2 3-1.3 3.3-3.1.3-1.5-.4-2.6-1.6-3.1.6-.3 1.1-.9 1.3-1.7zm-3.1 3.6c-.2 1.1-1.4 1.6-2.7 1.3-.4-.1-.7-.2-1.1-.3l.7-2.8c.4.1.8.2 1.2.3 1.3.3 2.1.8 1.9 1.5zm-1.3-3.6c-.2.9-1.2 1.4-2.3 1.2-.3-.1-.6-.1-.9-.2l.6-2.5c.3.1.6.1.9.2 1.1.3 1.9.7 1.7 1.3z"
          fill="white"
        />
      </svg>
    );
  }

  // f(x) Protocol FXN — violet stylised F
  if (s === 'FXN') {
    return (
      <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
        <circle cx="16" cy="16" r="16" fill="#7C5CFF" />
        <g stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 9v14" />
          <path d="M13 9c0-2 1.5-3 4-3h5" />
          <path d="M13 16h7" />
        </g>
      </svg>
    );
  }

  // fxUSD — stablecoin with f(x) violet accent
  if (s === 'FXUSD') {
    return (
      <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
        <circle cx="16" cy="16" r="16" fill="#0A0A12" stroke="#7C5CFF" strokeWidth="1.5" />
        <text x="16" y="20" textAnchor="middle" fill="#7C5CFF" fontSize="11" fontWeight="700" fontFamily="sans-serif">fx$</text>
      </svg>
    );
  }

  // fxSAVE — savings pool, same family as fxUSD with a leaf/save hint
  if (s === 'FXSAVE') {
    return (
      <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
        <circle cx="16" cy="16" r="16" fill="#0A0A12" stroke="#00D68F" strokeWidth="1.5" />
        <path d="M16 8c-4 4-4 10 0 14 4-4 4-10 0-14z" fill="#00D68F" />
      </svg>
    );
  }

  // FRAX governance token (prev. FXS) — Fraxtal orange/red F
  if (s === 'FRAX') {
    return (
      <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
        <circle cx="16" cy="16" r="16" fill="#E84142" />
        <g stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 9v14" />
          <path d="M13 9c0-2 1.5-3 4-3h5" />
          <path d="M13 16h7" />
        </g>
      </svg>
    );
  }

  // USDC
  if (s === 'USDC') {
    return (
      <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
        <circle cx="16" cy="16" r="16" fill="#2775CA" />
        <path d="M16 8c4.4 0 8 3.6 8 8s-3.6 8-8 8-8-3.6-8-8 3.6-8 8-8z" fill="none" stroke="white" strokeWidth="1.2" />
        <text x="16" y="21" textAnchor="middle" fill="white" fontSize="10" fontWeight="700" fontFamily="sans-serif">$</text>
      </svg>
    );
  }

  // USDT
  if (s === 'USDT') {
    return (
      <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
        <circle cx="16" cy="16" r="16" fill="#26A17B" />
        <text x="16" y="21" textAnchor="middle" fill="white" fontSize="10" fontWeight="700" fontFamily="sans-serif">T</text>
      </svg>
    );
  }

  // Generic fallback: gradient circle with initials
  const initials = symbol.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || symbol.slice(0, 2).toUpperCase();
  return (
    <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
      <defs>
        <linearGradient id={`fallback-${symbol}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--mint, #7C5CFF)" />
          <stop offset="100%" stopColor="var(--cyan, #00D68F)" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#fallback-${symbol})`} />
      <text x="16" y="20" textAnchor="middle" fill="white" fontSize="10" fontWeight="700" fontFamily="sans-serif">{initials}</text>
    </svg>
  );
}

export default TokenIcon;
