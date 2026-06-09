import { describe, it, expect } from 'vitest';
import { FXSDK } from '../../src/core/fx-sdk';

describe('FX SDK', () => {
  const sdk = new FXSDK('https://eth.llamarpc.com');

  it('should get price for ETH', async () => {
    const price = await sdk.getPrice('ETH');
    expect(price.price).toBeDefined();
    expect(price.timestamp).toBeGreaterThan(0);
  });

  it('should return null for non-existent position', async () => {
    const position = await sdk.getPosition('0x123', 'xETH');
    expect(position).toBeNull();
  });
});
