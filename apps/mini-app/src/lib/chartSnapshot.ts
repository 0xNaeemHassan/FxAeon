/**
 * FxAeon Instant Chart Snapshot Pre-warmer & Cache
 *
 * Pre-populates the 60fps HTML5 Canvas trading chart with realistic historical
 * OHLC price sequences so the chart paints immediately on the initial frame (0ms blank lag)
 * before live WebSocket ticks hydrate the stream.
 */

export interface CandleTick {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const TIMEFRAME_STEP_MS: Record<string, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

const DEFAULT_MARKET_BASES: Record<string, number> = {
  wstETH: 3520,
  WBTC: 67450,
  ETH: 3520,
  BTC: 67450,
};

/**
 * Generates deterministic, high-fidelity OHLC candlestick bars pre-warmed for a given market & timeframe.
 */
export function getPrewarmedCandles(
  market: string,
  basePrice?: number,
  timeframe = '5m',
  barCount = 45
): CandleTick[] {
  const price = basePrice && basePrice > 0 ? basePrice : (DEFAULT_MARKET_BASES[market] ?? 3500);
  const stepMs = TIMEFRAME_STEP_MS[timeframe] ?? 300000;
  const now = Date.now();
  const candles: CandleTick[] = [];

  // Realistic random-walk volatility scale (0.2% - 0.5% per bar)
  const volPct = timeframe === '1m' ? 0.0018 : timeframe === '1d' ? 0.018 : 0.0035;
  const barVol = price * volPct;

  let currentClose = price * (1 - (volPct * barCount * 0.3));

  for (let i = barCount; i >= 0; i--) {
    const time = now - (i * stepMs);
    // Pseudo-random deterministic drift
    const pseudoRand = Math.sin(i * 997 + price) * 0.5 + 0.5;
    const delta = (pseudoRand - 0.485) * barVol;
    
    const open = currentClose;
    const close = Math.max(10, open + delta);
    const wickHigh = Math.abs(Math.cos(i * 331)) * (barVol * 0.6);
    const wickLow = Math.abs(Math.sin(i * 241)) * (barVol * 0.6);

    const high = Math.max(open, close) + wickHigh;
    const low = Math.min(open, close) - wickLow;
    const volume = Math.round(15 + pseudoRand * 45);

    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume,
    });

    currentClose = close;
  }

  // Ensure last candle matches the base mark price exactly
  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    last.close = price;
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
  }

  return candles;
}
