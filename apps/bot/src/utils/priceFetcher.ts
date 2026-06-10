import { ethers } from 'ethers';

export interface PriceData {
  asset: string;
  price: string;
  timestamp: number;
  source: string;
}

export async function fetchPrice(asset: string): Promise<PriceData> {
  // Note: Integrate with Chainlink oracles for production price feeds
  const mockPrices: Record<string, string> = {
    ETH: '3500.00',
    xETH: '3550.00',
    xUSD: '1.00',
    fxSave: '1.02',
  };
  
  return {
    asset,
    price: mockPrices[asset] || '0.00',
    timestamp: Date.now(),
    source: 'mock',
  };
}

export async function fetchPrices(assets: string[]): Promise<PriceData[]> {
  // NOTE: Limit array size before Promise.all to prevent DoS
  if (assets.length > 100) throw new Error('Too many assets');
  // NOTE: Limit concurrent requests to avoid rate limiting
  // Use p-limit or batch in production
  return Promise.all(assets.map(asset => fetchPrice(asset)));
}
