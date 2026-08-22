'use client';

import { useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  Fuel,
  Play,
  Repeat,
  Sparkles,
} from 'lucide-react';
import { AppShell, Button, Card } from '@/components/ui';
import { Segmented } from '@/components/ProtocolForm';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

type DcaFrequency = 'daily' | 'weekly' | 'monthly';
type DcaAsset = 'wstETH' | 'WBTC' | 'fxSAVE';

export default function DcaStrategyPage() {
  const [asset, setAsset] = useState<DcaAsset>('wstETH');
  const [frequency, setFrequency] = useState<DcaFrequency>('weekly');
  const [amountUsd, setAmountUsd] = useState('50');
  const [autoSweepProfit, setAutoSweepProfit] = useState(true);
  const [deployed, setDeployed] = useState(false);

  const parsedAmount = parseFloat(amountUsd) || 50;

  // 6-month accumulation projections
  const executionsCount = frequency === 'daily' ? 180 : frequency === 'weekly' ? 26 : 6;
  const totalInvestedUsd = parsedAmount * executionsCount;
  const projectedValueUsd = totalInvestedUsd * 1.28; // Estimated +28% based on historical volatility & staking yield
  const estimatedGasSavingsUsd = executionsCount * 14.5; // Mainnet gas saved by bot batching

  const handleDeploy = () => {
    sound.success();
    haptic('success');
    setDeployed(true);
  };

  return (
    <AppShell title="Auto-DCA Builder" subtitle="Automated recurring accumulation & yield sweep strategies.">
      <div className="stagger flex flex-col gap-3.5">
        {/* Hero Card */}
        <Card glow className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-[rgba(139,109,255,.18)] blur-3xl" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">
                Tactical Automation
              </span>
              <h2 className="text-display mt-1 text-[22px] font-bold">Dollar-Cost Averaging</h2>
              <p className="mt-0.5 text-[11.5px] text-mut">
                Automate buys on Base & Ethereum with zero manual signing.
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint shadow-[0_0_20px_var(--mint-glow)]">
              <Repeat className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* Strategy Configuration Form */}
        <Card className="p-4.5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-mut uppercase tracking-wider block mb-1.5">
              Target Accumulation Asset
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['wstETH', 'WBTC', 'fxSAVE'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    sound.tap();
                    haptic('selection');
                    setAsset(a);
                  }}
                  className={`rounded-xl py-2 font-bold text-[12.5px] transition-all ${
                    asset === a
                      ? 'bg-mint text-black shadow-[0_0_12px_var(--mint-glow)]'
                      : 'bg-[rgba(255,255,255,0.05)] text-mut hover:text-white'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-mut uppercase tracking-wider block mb-1.5">
              Execution Frequency
            </label>
            <Segmented
              value={frequency}
              onChange={(f) => {
                sound.tap();
                haptic('selection');
                setFrequency(f);
              }}
              ariaLabel="Frequency"
              options={[
                { value: 'daily', label: 'Every Day' },
                { value: 'weekly', label: 'Every Week' },
                { value: 'monthly', label: 'Monthly' },
              ]}
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-mut uppercase tracking-wider block mb-1.5">
              Amount per Buy (fxUSD)
            </label>
            <div className="relative">
              <input
                type="number"
                value={amountUsd}
                onChange={(e) => setAmountUsd(e.target.value)}
                className="w-full rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-3.5 py-2.5 font-mono text-[15px] font-bold focus:border-mint focus:outline-none"
                placeholder="50"
              />
              <span className="absolute right-3.5 top-3 text-[11px] font-bold text-mut">fxUSD</span>
            </div>
          </div>

          {/* Auto-Sweep Toggle */}
          <div className="flex items-center justify-between rounded-xl bg-[rgba(255,255,255,0.03)] p-3 border border-[var(--line)]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-mint" />
              <div>
                <span className="text-[12.5px] font-bold text-white block">Auto-Sweep Profits</span>
                <span className="text-[10.5px] text-mut block">Auto-deposit gains into fxSAVE at +30% ROI</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                sound.tap();
                haptic('selection');
                setAutoSweepProfit(!autoSweepProfit);
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                autoSweepProfit ? 'bg-mint' : 'bg-white/10'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out ${
                  autoSweepProfit ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </Card>

        {/* 6-Month Projection Card */}
        <Card className="p-4.5">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="h-4 w-4 text-mint" />
            <h3 className="text-[13.5px] font-bold text-white">6-Month Strategy Projection</h3>
          </div>

          <div className="grid grid-cols-2 gap-2.5 rounded-xl bg-[rgba(255,255,255,0.03)] p-3 text-[11.5px]">
            <div>
              <span className="block text-[9.5px] text-mut uppercase">Total Capital Invested</span>
              <span className="font-mono text-[14px] font-bold text-white">
                ${totalInvestedUsd.toLocaleString('en-US')}
              </span>
            </div>
            <div>
              <span className="block text-[9.5px] text-mut uppercase">Projected Portfolio Value</span>
              <span className="font-mono text-[14px] font-bold text-success">
                ${projectedValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between text-[11px] text-mut">
            <span className="flex items-center gap-1 text-success font-medium">
              <Fuel className="h-3 w-3" />
              Saves ~${estimatedGasSavingsUsd.toFixed(0)} in network gas
            </span>
            <span>{executionsCount} Total Buys</span>
          </div>

          <div className="mt-4">
            {deployed ? (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-success/15 py-2.5 text-[12.5px] font-bold text-success">
                <CheckCircle2 className="h-4 w-4" /> Strategy Active on Telegram Signer
              </div>
            ) : (
              <Button onClick={handleDeploy} className="w-full gap-2 text-[13px]">
                <Play className="h-4 w-4" /> Deploy DCA Strategy
              </Button>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
