'use client';

import TokenIcon from '@/components/TokenIcon';
import { useUsdPrices } from '@/components/PriceProvider';
import { formatUsdPrice } from '@/lib/prices';

const MARKETS = [
  { key: 'ETH', label: 'ETH' },
  { key: 'WBTC', label: 'BTC' },
  { key: 'fxUSD', label: 'fxUSD' },
  { key: 'FXN', label: 'FXN' },
] as const;

export default function LiveMarketStrip({ className = '' }: { className?: string }) {
  const { prices, updatedAt } = useUsdPrices();
  const visibleMarkets = MARKETS.filter(({ key }) => {
    const price = prices[key];
    return typeof price === 'number' && Number.isFinite(price) && price > 0;
  });
  if (!visibleMarkets.length) return null;
  return (
    <section className={`market-strip ${className}`} aria-label="Market prices" title={updatedAt ? `Updated ${new Date(updatedAt).toISOString()}` : undefined}>
      <div className="market-strip-items">
        {visibleMarkets.map(({ key, label }) => (
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
