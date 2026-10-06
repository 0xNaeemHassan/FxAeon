import { useId } from 'react';

/** Stable, local avatar for a wallet address: a lit gradient orb whose hues
 * are derived from the address alone. No avatar URL or remote data. */
export function WalletAvatar({ address, size = 32 }: { address: string; size?: number }) {
  const id = `wallet-avatar-${useId().replace(/:/g, '')}`;
  const seed = address.toLowerCase().replace(/^0x/, '');
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const value = hash >>> 0;
  const base = value % 360;
  const second = (base + 36 + ((value >>> 9) % 70)) % 360;
  const deep = (base + 170 + ((value >>> 17) % 80)) % 360;
  const angle = (value >>> 3) % 360;

  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id={`${id}-light`} cx="0.32" cy="0.26" r="0.92">
        <stop offset="0" stopColor={`hsl(${base} 92% 74%)`} />
        <stop offset="0.52" stopColor={`hsl(${second} 72% 54%)`} />
        <stop offset="1" stopColor={`hsl(${deep} 62% 26%)`} />
      </radialGradient>
      <linearGradient id={`${id}-sheen`} gradientTransform={`rotate(${angle} 0.5 0.5)`}>
        <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
        <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
    </defs>
    <circle cx="20" cy="20" r="20" fill={`url(#${id}-light)`} />
    <circle cx="20" cy="20" r="20" fill={`url(#${id}-sheen)`} />
    <circle cx="20" cy="20" r="19.5" stroke="#fff" strokeOpacity="0.14" />
  </svg>;
}
