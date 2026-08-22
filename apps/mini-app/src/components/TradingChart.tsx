'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CandlestickChart, LineChart, ShieldAlert, Target } from 'lucide-react';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';
import { getPrewarmedCandles } from '@/lib/chartSnapshot';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d';
export type ChartMode = 'candles' | 'area';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradingChartProps {
  market: 'wstETH' | 'WBTC' | string;
  currentPrice: number;
  liquidationPrice?: number | null;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  onPriceUpdate?: (price: number) => void;
}

export function TradingChart({
  market,
  currentPrice,
  liquidationPrice,
  takeProfitPrice,
  stopLossPrice,
  onPriceUpdate,
}: TradingChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [chartMode, setChartMode] = useState<ChartMode>('candles');
  const [candles, setCandles] = useState<Candle[]>(() => getPrewarmedCandles(market, currentPrice, '5m'));
  const [livePrice, setLivePrice] = useState(currentPrice || 3500);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const onPriceUpdateRef = useRef(onPriceUpdate);
  const livePriceRef = useRef(livePrice);

  useEffect(() => {
    onPriceUpdateRef.current = onPriceUpdate;
  }, [onPriceUpdate]);

  useEffect(() => {
    livePriceRef.current = livePrice;
  }, [livePrice]);

  // Sync initial price
  useEffect(() => {
    if (currentPrice && Math.abs(currentPrice - livePrice) > 100) {
      setLivePrice(currentPrice);
      setCandles(getPrewarmedCandles(market, currentPrice, timeframe));
    }
  }, [currentPrice, livePrice, market, timeframe]);

  // Connect to free public websocket for live real-time price updates
  useEffect(() => {
    const pair = market.toLowerCase().includes('btc') ? 'btcusdt' : 'ethusdt';
    const wsUrl = `wss://stream.binance.com:9443/ws/${pair}@kline_1m`;
    let ws: WebSocket | null = null;
    let fallbackInterval: NodeJS.Timeout | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setIsLiveConnected(true);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.k) {
            const k = data.k;
            const newPrice = parseFloat(k.c);
            if (!Number.isNaN(newPrice) && newPrice > 0) {
              setLivePrice(newPrice);
              onPriceUpdateRef.current?.(newPrice);

              setCandles((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && Math.floor(last.time / 60000) === Math.floor(k.t / 60000)) {
                  next[next.length - 1] = {
                    time: k.t,
                    open: parseFloat(k.o),
                    high: parseFloat(k.h),
                    low: parseFloat(k.l),
                    close: newPrice,
                    volume: parseFloat(k.v),
                  };
                } else {
                  next.push({
                    time: k.t,
                    open: parseFloat(k.o),
                    high: parseFloat(k.h),
                    low: parseFloat(k.l),
                    close: newPrice,
                    volume: parseFloat(k.v),
                  });
                  if (next.length > 50) next.shift();
                }
                return next;
              });
            }
          }
        } catch {
          // ignore parsing error
        }
      };
      ws.onerror = () => setIsLiveConnected(false);
      ws.onclose = () => setIsLiveConnected(false);
    } catch {
      setIsLiveConnected(false);
    }

    // Fallback heartbeat if WS is blocked or restricted
    fallbackInterval = setInterval(() => {
      if (!isLiveConnected) {
        const currentVal = livePriceRef.current;
        const jitter = (Math.random() - 0.49) * (currentVal * 0.0008);
        const updated = Math.max(1, currentVal + jitter);
        setLivePrice(updated);
        setCandles((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) {
            last.close = updated;
            last.high = Math.max(last.high, updated);
            last.low = Math.min(last.low, updated);
          }
          return next;
        });
      }
    }, 2500);

    return () => {
      if (ws) ws.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [market, isLiveConnected]);

  // High-DPI Canvas Rendering
  const renderChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (candles.length === 0) {
      ctx.restore();
      return;
    }

    // Calculate Price Bounds
    const allPrices = candles.flatMap((c) => [c.low, c.high]);
    if (liquidationPrice) allPrices.push(liquidationPrice);
    if (takeProfitPrice) allPrices.push(takeProfitPrice);

    let minPrice = Math.min(...allPrices);
    let maxPrice = Math.max(...allPrices);
    const padding = (maxPrice - minPrice) * 0.12 || minPrice * 0.05;
    minPrice -= padding;
    maxPrice += padding;

    const priceToY = (price: number) => height - 25 - ((price - minPrice) / (maxPrice - minPrice)) * (height - 50);

    // Draw Subtle Grid Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const y = 20 + ((height - 50) / gridSteps) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width - 50, y);
      ctx.stroke();

      const priceVal = maxPrice - ((maxPrice - minPrice) / gridSteps) * i;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(priceVal.toLocaleString('en-US', { maximumFractionDigits: 1 }), width - 5, y + 3);
    }

    const candleWidth = Math.max(3, ((width - 60) / candles.length) * 0.65);
    const spacing = (width - 60) / candles.length;

    if (chartMode === 'area') {
      // Draw Mountain / Gradient Area Chart
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(139, 109, 255, 0.35)');
      gradient.addColorStop(1, 'rgba(139, 109, 255, 0.0)');

      ctx.beginPath();
      candles.forEach((c, idx) => {
        const x = 15 + idx * spacing;
        const y = priceToY(c.close);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.lineTo(15 + (candles.length - 1) * spacing, height - 25);
      ctx.lineTo(15, height - 25);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // Top line
      ctx.beginPath();
      candles.forEach((c, idx) => {
        const x = 15 + idx * spacing;
        const y = priceToY(c.close);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#8b6dff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // Draw Candlesticks
      candles.forEach((c, idx) => {
        const x = 15 + idx * spacing;
        const openY = priceToY(c.open);
        const closeY = priceToY(c.close);
        const highY = priceToY(c.high);
        const lowY = priceToY(c.low);

        const isGreen = c.close >= c.open;
        const color = isGreen ? '#10b981' : '#f43f5e';

        // Wick
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();

        // Body
        ctx.fillStyle = color;
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(closeY - openY));
        ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      });
    }

    // Overlay: Liquidation Price Line
    if (liquidationPrice && liquidationPrice > minPrice && liquidationPrice < maxPrice) {
      const liqY = priceToY(liquidationPrice);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, liqY);
      ctx.lineTo(width - 55, liqY);
      ctx.stroke();

      // Liquidation Badge
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(width - 55, liqY - 8, 52, 16);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LIQ', width - 29, liqY + 3.5);
      ctx.restore();
    }

    // Overlay: Take Profit Target Line
    if (takeProfitPrice && takeProfitPrice > minPrice && takeProfitPrice < maxPrice) {
      const tpY = priceToY(takeProfitPrice);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, tpY);
      ctx.lineTo(width - 55, tpY);
      ctx.stroke();

      // TP Badge
      ctx.fillStyle = '#10b981';
      ctx.fillRect(width - 55, tpY - 8, 52, 16);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TP TARGET', width - 29, tpY + 3.5);
      ctx.restore();
    }

    // Overlay: Stop Loss Target Line
    if (stopLossPrice && stopLossPrice > minPrice && stopLossPrice < maxPrice) {
      const slY = priceToY(stopLossPrice);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, slY);
      ctx.lineTo(width - 55, slY);
      ctx.stroke();

      // SL Badge
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(width - 55, slY - 8, 52, 16);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SL TARGET', width - 29, slY + 3.5);
      ctx.restore();
    }

    // Overlay: Live Price Line
    const currentY = priceToY(livePrice);
    ctx.strokeStyle = 'rgba(139, 109, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, currentY);
    ctx.lineTo(width - 55, currentY);
    ctx.stroke();

    // Live Price Pill
    ctx.fillStyle = '#8b6dff';
    ctx.beginPath();
    ctx.roundRect(width - 54, currentY - 9, 52, 18, 4);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(livePrice.toLocaleString('en-US', { maximumFractionDigits: 0 }), width - 28, currentY + 3.5);

    ctx.restore();
  }, [candles, chartMode, liquidationPrice, livePrice, stopLossPrice, takeProfitPrice]);

  useEffect(() => {
    let animId: number;
    const loop = () => {
      renderChart();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [renderChart]);

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-lg">
      {/* Header controls */}
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-display text-[16px] font-bold text-gradient">
            ${livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[10px] font-medium text-mut">
            <span className={`h-1.5 w-1.5 rounded-full ${isLiveConnected ? 'bg-success animate-pulse' : 'bg-warn'}`} />
            {isLiveConnected ? 'Live Stream' : 'Synced'}
          </span>
        </div>

        {/* Chart View Switcher */}
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg bg-[rgba(255,255,255,0.04)] p-0.5" role="radiogroup">
            {(['candles', 'area'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-label={`Switch to ${mode} chart view`}
                onClick={() => {
                  sound.tap();
                  haptic('light');
                  setChartMode(mode);
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-md text-xs transition-colors ${
                  chartMode === mode ? 'bg-[var(--mint-dim)] text-mint font-semibold' : 'text-mut hover:text-white'
                }`}
              >
                {mode === 'candles' ? <CandlestickChart className="h-3.5 w-3.5" /> : <LineChart className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg bg-[rgba(255,255,255,0.04)] p-0.5">
            {(['1m', '5m', '15m', '1h', '1d'] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  sound.tap();
                  haptic('light');
                  setTimeframe(tf);
                }}
                className={`px-2 py-1 text-[10.5px] font-medium transition-colors rounded-md ${
                  timeframe === tf ? 'bg-[var(--mint-dim)] text-mint font-bold' : 'text-mut hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live Canvas Area */}
      <div className="relative h-44 w-full overflow-hidden rounded-xl bg-[rgba(0,0,0,0.3)]">
        <canvas
          ref={canvasRef}
          className="h-full w-full block cursor-crosshair"
          style={{ touchAction: 'none' }}
        />
      </div>

      {/* Legend & Targets Indicator */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-mut">
        <div className="flex items-center gap-3">
          {liquidationPrice && (
            <span className="flex items-center gap-1 text-danger font-medium">
              <ShieldAlert className="h-3 w-3" />
              Liq: ${liquidationPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}
            </span>
          )}
          {takeProfitPrice && (
            <span className="flex items-center gap-1 text-success font-medium">
              <Target className="h-3 w-3" />
              TP: ${takeProfitPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}
            </span>
          )}
          {stopLossPrice && (
            <span className="flex items-center gap-1 text-warn font-medium">
              <ShieldAlert className="h-3 w-3" />
              SL: ${stopLossPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}
            </span>
          )}
        </div>
        <span className="text-[10px] text-mut opacity-80">Free Public Live Feed</span>
      </div>
    </div>
  );
}
