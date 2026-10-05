/** Stable, local identicon for a wallet address. No avatar URL or remote data. */
export function WalletAvatar({ address, size = 32 }: { address: string; size?: number }) {
  const seed = address.toLowerCase().replace(/^0x/, '');
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  const cells: Array<{ x: number; y: number; value: number }> = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const value = Number.parseInt(seed[(row * 3 + column) % Math.max(seed.length, 1)] ?? '0', 16) || 0;
      if ((value & (1 << (row % 4))) === 0) continue;
      cells.push({ x: column, y: row, value });
      if (column < 2) cells.push({ x: 4 - column, y: row, value });
    }
  }

  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="38" height="38" rx="13" fill={`hsl(${hue} 46% 20%)`} />
    {cells.map(({ x, y, value }) => <rect
      key={`${x}-${y}`}
      x={4 + x * 6.5}
      y={4 + y * 6.5}
      width="5.5"
      height="5.5"
      rx="1.8"
      fill={`hsl(${(hue + value * 5) % 360} 82% ${value % 3 === 0 ? 72 : 62}%)`}
    />)}
  </svg>;
}
