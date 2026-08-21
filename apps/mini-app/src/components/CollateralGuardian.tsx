'use client';

import { useState } from 'react';
import {
  Fuel,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Card } from '@/components/ui';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

interface CollateralGuardianProps {
  currentLiquidationPrice: number;
  currentSpotPrice: number;
  currentCollateralUsd: number;
  currentDebtUsd: number;
  market?: string;
}

export function CollateralGuardian({
  currentLiquidationPrice,
  currentSpotPrice,
  currentCollateralUsd,
  currentDebtUsd,
  market: _market,
}: CollateralGuardianProps) {
  const [boostPct, setBoostPct] = useState<number>(25);

  const additionalCollateral = (currentCollateralUsd * boostPct) / 100;
  const newCollateral = currentCollateralUsd + additionalCollateral;

  // New simulated liquidation price (assuming debt stays constant)
  const collateralRatio = currentDebtUsd > 0 ? (newCollateral / currentDebtUsd) : 1.5;
  const priceDropTolerancePct = Math.min(95, Math.max(5, (1 - 1 / collateralRatio) * 100));
  const newLiquidationPrice = currentSpotPrice * (1 - priceDropTolerancePct / 100);
  const bufferExpansionUsd = Math.max(0, currentLiquidationPrice - newLiquidationPrice);

  return (
    <Card glow className="p-4.5 border border-mint/20">
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-[14px] font-bold text-white">Collateral Guardian</h3>
            <p className="text-[11px] text-mut">De-risk simulator & liquidation shield</p>
          </div>
        </div>
        <span className="rounded-full bg-[var(--mint-dim)] px-2.5 py-0.5 text-[10.5px] font-bold text-mint">
          Active Shield
        </span>
      </div>

      {/* Boost Preset Selector */}
      <div className="mb-3">
        <label className="text-[11px] font-medium text-mut">Simulate Adding Collateral Buffer</label>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {[10, 25, 50, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => {
                sound.tap();
                haptic('selection');
                setBoostPct(pct);
              }}
              className={`rounded-xl py-1.5 text-[12px] font-bold transition-all ${
                boostPct === pct
                  ? 'bg-mint text-black shadow-[0_0_12px_var(--mint-glow)]'
                  : 'bg-[rgba(255,255,255,0.05)] text-mut hover:text-white'
              }`}
            >
              +{pct}%
            </button>
          ))}
        </div>
      </div>

      {/* Comparison Metrics */}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-[rgba(255,255,255,0.03)] p-3 text-[11.5px]">
        <div>
          <span className="block text-[10px] text-mut">Current Liq Price</span>
          <span className="font-mono text-[14px] font-bold text-danger">
            ${currentLiquidationPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-mut">Projected Liq Price</span>
          <span className="font-mono text-[14px] font-bold text-success">
            ${newLiquidationPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-mut">
        <span className="flex items-center gap-1 text-success font-medium">
          <Sparkles className="h-3 w-3" />
          Adds +${bufferExpansionUsd.toFixed(0)} safety buffer
        </span>
        <span className="flex items-center gap-1 font-mono text-[10.5px]">
          <Fuel className="h-3 w-3 text-cyan-400" /> Base Gas: &lt;$0.01
        </span>
      </div>
    </Card>
  );
}
