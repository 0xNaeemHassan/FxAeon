import { describe, it, expect } from 'vitest';
import { parseIntent } from '../src/agent/intentParser.js';

describe('Inline Query Trade Parser', () => {
  it('parses natural inline queries into executable trade intents', () => {
    const r1 = parseIntent('long eth 0.5 wsteth 3x');
    expect(r1.action).toBe('open_long');
    expect(r1.market).toBe('wstETH');
    expect(r1.leverage).toBe(3);

    const r2 = parseIntent('short btc 0.05 wbtc 5x');
    expect(r2.action).toBe('open_short');
    expect(r2.market).toBe('WBTC');
    expect(r2.leverage).toBe(5);
  });
});
