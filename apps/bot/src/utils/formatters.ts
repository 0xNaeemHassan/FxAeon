export function formatEth(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return `${num.toFixed(6)} ETH`;
}

export function formatUsd(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return `$${num.toFixed(2)}`;
}

export function formatPercentage(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

export function formatLeverage(value: number): string {
  return `${value}x`;
}

export function formatAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
