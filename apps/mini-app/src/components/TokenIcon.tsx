'use client';

/* eslint-disable @next/next/no-img-element */

/**
 * Token and network marks used across the Mini App.
 *
 * Supported marks are vendored from the maintained sources listed in
 * docs/brand-assets.md. Keeping them under public/ makes the picker stable
 * when a wallet opens offline or an asset CDN is slow. Unknown symbols retain
 * the small initials fallback below; it is never used for a supported mark.
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

const LOCAL_TOKEN_LOGOS: Record<string, string> = {
  ETH: '/token-icons/eth.png',
  WETH: '/token-icons/weth.png',
  STETH: '/token-icons/steth.png',
  WSTETH: '/token-icons/wsteth.png',
  WBTC: '/token-icons/wbtc.png',
  BTC: '/token-icons/wbtc.png',
  FRAX: '/token-icons/frax.png',
  FXN: '/token-icons/fxn.png',
  FXUSD: '/token-icons/fxusd.svg',
  FXSAVE: '/token-icons/fxsave.svg',
  USDC: '/token-icons/usdc.png',
  USDT: '/token-icons/usdt.png',
};

export function TokenIcon({ symbol, size = 44, className = '' }: TokenIconProps) {
  const normalised = symbol.toUpperCase();
  const localLogo = LOCAL_TOKEN_LOGOS[normalised];
  const style = { width: size, height: size };

  if (localLogo) {
    return <img src={localLogo} style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`} alt="" width={size} height={size} decoding="async" />;
  }

  const initials = symbol.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() || symbol.slice(0, 2).toUpperCase();
  const gradientId = `fallback-${normalised.replace(/[^A-Z0-9_-]/g, '-') || 'token'}`;
  return (
    <svg viewBox="0 0 32 32" style={style} className={`${common} ${className}`} role="img" aria-label={`${symbol} logo`}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--mint, #7C5CFF)" />
          <stop offset="100%" stopColor="var(--cyan, #00D68F)" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${gradientId})`} />
      <text x="16" y="20" textAnchor="middle" fill="white" fontSize="10" fontWeight="700" fontFamily="sans-serif">{initials}</text>
    </svg>
  );
}

const LOCAL_CHAIN_LOGOS: Record<1 | 8453, string> = {
  1: '/chain-icons/ethereum.png',
  8453: '/chain-icons/base.png',
};

export function ChainIcon({ chainId, size = 28, className = '' }: { chainId: 1 | 8453; size?: number; className?: string }) {
  const style = { width: size, height: size };
  const label = chainId === 1 ? 'Ethereum logo' : 'Base logo';
  return <img src={LOCAL_CHAIN_LOGOS[chainId]} style={style} className={`${common} ${className}`} role="img" aria-label={label} alt="" width={size} height={size} decoding="async" />;
}

export default TokenIcon;
