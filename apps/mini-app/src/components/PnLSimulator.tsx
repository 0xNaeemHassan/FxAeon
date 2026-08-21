'use client';

import { useEffect, useState } from 'react';
import { Calculator, ChevronDown, ChevronUp, ShieldCheck, Target } from 'lucide-react';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

interface PnLSimulatorProps {
  side: 'long' | 'short';
  leverage: number;
  entryPrice: number;
  marginUsd: number;
  onTakeProfitChange?: (targetPrice: number | null) => void;
  onStopLossChange?: (stopPrice: number | null) => void;
}

export function PnLSimulator({
  side,
  leverage,
  entryPrice,
  marginUsd,
  onTakeProfitChange,
  onStopLossChange,
}: PnLSimulatorProps) {
  const [tpPercent, setTpPercent] = useState<number>(30); // Target +30% ROI
  const [slPercent, setSlPercent] = useState<number>(-15); // Stop Loss -15% ROI
  const [isOpen, setIsOpen] = useState(false);

  const priceMultiplier = side === 'long' ? 1 : -1;

  // Calculate target prices based on ROI & leverage
  // ROI% = (PriceDelta% * leverage) => PriceDelta% = ROI% / leverage
  const tpPriceDeltaPct = tpPercent / (leverage * 100);
  const targetTpPrice = entryPrice > 0 ? entryPrice * (1 + tpPriceDeltaPct * priceMultiplier) : 0;

  const slPriceDeltaPct = Math.abs(slPercent) / (leverage * 100);
  const targetSlPrice = entryPrice > 0 ? entryPrice * (1 - slPriceDeltaPct * priceMultiplier) : 0;

  const estimatedProfitUsd = marginUsd > 0 ? marginUsd * (tpPercent / 100) : 0;
  const estimatedMaxLossUsd = marginUsd > 0 ? marginUsd * (Math.abs(slPercent) / 100) : 0;
  const riskRewardRatio = estimatedMaxLossUsd > 0 ? (estimatedProfitUsd / estimatedMaxLossUsd).toFixed(2) : '—';

  useEffect(() => {
    onTakeProfitChange?.(targetTpPrice > 0 ? targetTpPrice : null);
  }, [targetTpPrice, onTakeProfitChange]);

  useEffect(() => {
    onStopLossChange?.(targetSlPrice > 0 ? targetSlPrice : null);
  }, [targetSlPrice, onStopLossChange]);

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3.5 transition-all">
      <button
        type="button"
        onClick={() => {
          sound.tap();
          haptic('selection');
          setIsOpen(!isOpen);
        }}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--mint-dim)] text-mint">
            <Calculator className="h-4 w-4" />
          </div>
          <div>
            <span className="text-[13px] font-semibold">Target & PnL Simulator</span>
            <p className="text-[10.5px] text-mut">Calculate Take-Profit, Stop-Loss & Risk-Reward</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-mut">
          <span className="rounded-md bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[10.5px] font-semibold text-mint">
            1 : {riskRewardRatio} R:R
          </span>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {isOpen && (
        <div className="mt-3.5 flex flex-col gap-3.5 border-t border-[var(--line)] pt-3.5">
          {/* Take Profit Setting */}
          <div>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="font-semibold text-success flex items-center gap-1">
                <Target className="h-3.5 w-3.5" /> Take Profit Target
              </span>
              <span className="font-mono font-bold text-success">
                ${targetTpPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })} (+{tpPercent}%)
              </span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {[15, 30, 50, 100].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    sound.tap();
                    haptic('light');
                    setTpPercent(val);
                  }}
                  className={`min-h-9 rounded-xl text-[11px] font-semibold transition-colors ${
                    tpPercent === val
                      ? 'bg-[var(--success-dim)] text-success border border-[rgba(16,185,129,0.4)]'
                      : 'bg-[rgba(255,255,255,0.035)] text-mut hover:text-white'
                  }`}
                >
                  +{val}%
                </button>
              ))}
            </div>
          </div>

          {/* Stop Loss Setting */}
          <div>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="font-semibold text-danger flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> Stop-Loss Target
              </span>
              <span className="font-mono font-bold text-danger">
                ${targetSlPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })} ({slPercent}%)
              </span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {[-10, -15, -25, -40].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    sound.tap();
                    haptic('light');
                    setSlPercent(val);
                  }}
                  className={`min-h-9 rounded-xl text-[11px] font-semibold transition-colors ${
                    slPercent === val
                      ? 'bg-[var(--danger-dim)] text-danger border border-[rgba(244,63,94,0.4)]'
                      : 'bg-[rgba(255,255,255,0.035)] text-mut hover:text-white'
                  }`}
                >
                  {val}%
                </button>
              ))}
            </div>
          </div>

          {/* Projected Outcomes Grid */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-[rgba(255,255,255,0.02)] p-2.5">
            <div>
              <span className="text-[10px] text-mut uppercase tracking-wider font-medium">Est. Profit</span>
              <p className="mt-0.5 font-mono text-[13px] font-bold text-success">
                +${estimatedProfitUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <span className="text-[10px] text-mut uppercase tracking-wider font-medium">Max Loss Risk</span>
              <p className="mt-0.5 font-mono text-[13px] font-bold text-danger">
                -${estimatedMaxLossUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
