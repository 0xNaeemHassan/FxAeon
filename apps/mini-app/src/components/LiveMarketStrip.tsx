'use client';

import { Activity } from 'lucide-react';
import TokenIcon from '@/components/TokenIcon';
import { useUsdPrices } from '@/components/PriceProvider';
import { formatUsdPrice } from '@/lib/prices';

const MARKETS = [
  { key: 'ETH', label: 'ETH' },
  { key: 'WBTC', label: 'BTC' },
  { key: 'fxUSD', label: 'fxUSD' },
] as const;

export default function LiveMarketStrip({ className = '' }: { className?: string }) {
  const { prices, status, updatedAt } = useUsdPrices();
  return (
    <section className={`market-strip ${className}`} aria-label="Live USD prices">
      <span className="market-strip-source" title={updatedAt ? `Updated ${new Date(updatedAt).toISOString()}` : 'Waiting for current prices'}>
        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
        {status === 'ready' ? 'Live USD' : status === 'partial' ? 'Partial USD' : status === 'stale' ? 'Last USD' : status === 'loading' ? 'Prices' : 'USD unavailable'}
      </span>
      <div className="market-strip-items">
        {MARKETS.map(({ key, label }) => (
          <span key={key} className="market-strip-item">
            <TokenIcon symbol={key} size={16} />
            <span>{label}</span>
            <strong>{formatUsdPrice(prices[key])}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}
