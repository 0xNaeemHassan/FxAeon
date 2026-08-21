'use client';

import { useId } from 'react';
import { AlertTriangle, ShieldCheck, ShieldAlert, Zap } from 'lucide-react';

export type RiskTier = 'safe' | 'moderate' | 'high' | 'critical';

export interface HealthGaugeProps {
  /** Health ratio between 0 and 1, or leverage number */
  value: number;
  mode?: 'health' | 'leverage';
  side?: 'long' | 'short';
  market?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showDetails?: boolean;
}

export function getRiskTier(value: number, mode: 'health' | 'leverage'): {
  tier: RiskTier;
  label: string;
  color: string;
  glowColor: string;
  textColor: string;
  bgColor: string;
  bufferPct: number;
} {
  if (mode === 'leverage') {
    const leverage = value;
    const bufferPct = leverage > 0 ? (1 / leverage) * 100 : 100;
    if (leverage <= 2) {
      return {
        tier: 'safe',
        label: 'Low Risk',
        color: 'var(--success, #36dfa6)',
        glowColor: 'rgba(54, 223, 166, 0.4)',
        textColor: 'text-success',
        bgColor: 'bg-[var(--success-dim)]',
        bufferPct,
      };
    }
    if (leverage <= 3.5) {
      return {
        tier: 'moderate',
        label: 'Moderate',
        color: 'var(--mint, #8b6dff)',
        glowColor: 'rgba(139, 109, 255, 0.4)',
        textColor: 'text-mint',
        bgColor: 'bg-[var(--mint-dim)]',
        bufferPct,
      };
    }
    if (leverage <= 6) {
      return {
        tier: 'high',
        label: 'High Risk',
        color: 'var(--warn, #ffc266)',
        glowColor: 'rgba(255, 194, 102, 0.4)',
        textColor: 'text-warn',
        bgColor: 'bg-[var(--warn-dim)]',
        bufferPct,
      };
    }
    return {
      tier: 'critical',
      label: 'Critical / Extreme',
      color: 'var(--danger, #ff6b76)',
      glowColor: 'rgba(255, 107, 118, 0.4)',
      textColor: 'text-danger',
      bgColor: 'bg-[var(--danger-dim)]',
      bufferPct,
    };
  }

  // Health mode (0.0 to 1.0)
  const health = Math.max(0, Math.min(1, value));
  const bufferPct = health * 100;
  if (health >= 0.65) {
    return {
      tier: 'safe',
      label: 'Healthy',
      color: 'var(--success, #36dfa6)',
      glowColor: 'rgba(54, 223, 166, 0.4)',
      textColor: 'text-success',
      bgColor: 'bg-[var(--success-dim)]',
      bufferPct,
    };
  }
  if (health >= 0.4) {
    return {
      tier: 'moderate',
      label: 'Moderate',
      color: 'var(--mint, #8b6dff)',
      glowColor: 'rgba(139, 109, 255, 0.4)',
      textColor: 'text-mint',
      bgColor: 'bg-[var(--mint-dim)]',
      bufferPct,
    };
  }
  if (health >= 0.2) {
    return {
      tier: 'high',
      label: 'Caution',
      color: 'var(--warn, #ffc266)',
      glowColor: 'rgba(255, 194, 102, 0.4)',
      textColor: 'text-warn',
      bgColor: 'bg-[var(--warn-dim)]',
      bufferPct,
    };
  }
  return {
    tier: 'critical',
    label: 'Liquidation Risk',
    color: 'var(--danger, #ff6b76)',
    glowColor: 'rgba(255, 107, 118, 0.4)',
    textColor: 'text-danger',
    bgColor: 'bg-[var(--danger-dim)]',
    bufferPct,
  };
}

export function HealthGauge({
  value,
  mode = 'health',
  side = 'long',
  market,
  size = 'md',
  className = '',
  showDetails = true,
}: HealthGaugeProps) {
  const gradientId = useId();
  const info = getRiskTier(value, mode);

  // SVG Gauge calculations
  // Arc angle from 135deg to 405deg (270deg sweep)
  const radius = size === 'sm' ? 28 : size === 'lg' ? 48 : 38;
  const strokeWidth = size === 'sm' ? 4.5 : size === 'lg' ? 7 : 6;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75; // 270 degrees
  
  // Normalized score (0 to 1)
  const normalized = mode === 'leverage'
    ? Math.max(0, Math.min(1, (10 - value) / (10 - 1.1)))
    : Math.max(0, Math.min(1, value));

  const strokeDashoffset = arcLength * (1 - normalized);

  const viewBoxSize = (radius + strokeWidth + 4) * 2;
  const center = viewBoxSize / 2;

  const Icon = info.tier === 'safe'
    ? ShieldCheck
    : info.tier === 'moderate'
      ? Zap
      : info.tier === 'high'
        ? AlertTriangle
        : ShieldAlert;

  return (
    <div className={`flex flex-col rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.025)] p-3.5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${info.bgColor} ${info.textColor}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mut">
            {mode === 'leverage' ? 'Liquidation Headroom' : 'Collateral Health'}
          </span>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${info.bgColor} ${info.textColor}`}>
          {info.label}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-4">
        {/* Radial gauge arc */}
        <div className="relative shrink-0 flex items-center justify-center" style={{ width: viewBoxSize * 0.85, height: viewBoxSize * 0.85 }}>
          <svg
            viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
            className="h-full w-full -rotate-90 transform"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#36dfa6" />
                <stop offset="50%" stopColor="#ffc266" />
                <stop offset="100%" stopColor="#ff6b76" />
              </linearGradient>
            </defs>

            {/* Background Track Arc */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={strokeWidth}
              strokeDasharray={`${arcLength} ${circumference}`}
              strokeLinecap="round"
              className="origin-center rotate-[135deg]"
            />

            {/* Active Gauge Arc */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={info.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arcLength} ${circumference}`}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="origin-center rotate-[135deg] transition-all duration-300 ease-out"
              style={{ filter: `drop-shadow(0 0 6px ${info.glowColor})` }}
            />
          </svg>

          {/* Central metric reading */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-display text-[15px] font-bold leading-none tracking-tight">
              {mode === 'leverage' ? `${value.toFixed(1)}×` : `${Math.round(info.bufferPct)}%`}
            </span>
          </div>
        </div>

        {/* Informational description */}
        {showDetails && (
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-baseline gap-1.5">
              <span className="text-display text-[17px] font-semibold text-[var(--text)]">
                ~{info.bufferPct.toFixed(1)}%
              </span>
              <span className="text-[10.5px] text-mut">market buffer</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-mut">
              {mode === 'leverage' ? (
                <>
                  Liquidation occurs if {market ?? 'market'} {side === 'long' ? 'drops' : 'rises'} by{' '}
                  <span className={`font-semibold ${info.textColor}`}>{info.bufferPct.toFixed(1)}%</span>.
                </>
              ) : (
                <>
                  Position maintains <span className={`font-semibold ${info.textColor}`}>{Math.round(info.bufferPct)}%</span> solvency margin.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
