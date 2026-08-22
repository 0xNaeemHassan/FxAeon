'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export type FoilTheme = 'rainbow' | 'gold' | 'cyber' | 'darkmatter';

export interface HoloCardProps {
  market?: string;
  side?: 'long' | 'short';
  leverage?: number;
  pnlPct?: number;
  pnlUsd?: number;
  entryPrice?: number;
  currentPrice?: number;
  traderName?: string;
  referralCode?: string;
  foil?: FoilTheme;
}

export function HoloCard({
  market = 'wstETH',
  side = 'long',
  leverage = 5.0,
  pnlPct = 68.4,
  pnlUsd = 1240.5,
  entryPrice = 3380,
  currentPrice = 3520,
  traderName = 'anon.f(x)oor',
  referralCode = '0x742d...f44e',
  foil = 'rainbow',
}: HoloCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);
  const [glareX, setGlareX] = useState(50);
  const [glareY, setGlareY] = useState(50);
  const [isHovered, setIsHovered] = useState(false);

  // Mouse / Touch Parallax Handler
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rX = ((y - centerY) / centerY) * -16;
    const rY = ((x - centerX) / centerX) * 16;

    setRotateX(rX);
    setRotateY(rY);
    setGlareX((x / rect.width) * 100);
    setGlareY((y / rect.height) * 100);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setIsHovered(false);
    setRotateX(0);
    setRotateY(0);
    setGlareX(50);
    setGlareY(50);
  }, []);

  // Mobile Device Gyroscope / Accelerometer
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      // gamma is left-to-right tilt [-90, 90]
      // beta is front-to-back tilt [-180, 180]
      const clampedGamma = Math.max(-30, Math.min(30, e.gamma));
      const clampedBeta = Math.max(-30, Math.min(30, e.beta - 45)); // assume holding phone at 45 deg

      setRotateY((clampedGamma / 30) * 18);
      setRotateX(-(clampedBeta / 30) * 18);
      setGlareX(((clampedGamma + 30) / 60) * 100);
      setGlareY(((clampedBeta + 30) / 60) * 100);
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientation', handleOrientation, true);
      }
    };
  }, []);

  // Foil Style Generators
  const getFoilOverlay = () => {
    switch (foil) {
      case 'rainbow':
        return `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,0,128,0.35), rgba(0,255,200,0.3), rgba(255,230,0,0.25), transparent 70%), linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 50%, rgba(255,255,255,0.25) 100%)`;
      case 'gold':
        return `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,215,0,0.6), rgba(218,165,32,0.35), rgba(184,134,11,0.2), transparent 75%), linear-gradient(120deg, rgba(255,248,220,0.4) 0%, transparent 40%, rgba(255,215,0,0.3) 100%)`;
      case 'cyber':
        return `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(54,223,166,0.5), rgba(0,255,136,0.3), rgba(0,0,0,0.4), transparent 70%), repeating-linear-gradient(0deg, rgba(54,223,166,0.06) 0px, rgba(54,223,166,0.06) 1px, transparent 1px, transparent 4px)`;
      case 'darkmatter':
        return `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(168,85,247,0.5), rgba(59,130,246,0.35), rgba(15,23,42,0.6), transparent 70%), radial-gradient(circle at ${100 - glareX}% ${100 - glareY}%, rgba(236,72,153,0.3), transparent 50%)`;
    }
  };

  const getBorderGlow = () => {
    switch (foil) {
      case 'rainbow':
        return 'border-[rgba(255,255,255,0.3)] shadow-[0_0_35px_rgba(54,223,166,0.35)]';
      case 'gold':
        return 'border-[rgba(255,215,0,0.5)] shadow-[0_0_35px_rgba(255,215,0,0.4)]';
      case 'cyber':
        return 'border-[rgba(54,223,166,0.5)] shadow-[0_0_35px_rgba(54,223,166,0.4)]';
      case 'darkmatter':
        return 'border-[rgba(168,85,247,0.5)] shadow-[0_0_35px_rgba(168,85,247,0.4)]';
    }
  };

  const isProfit = pnlPct >= 0;

  return (
    <div
      style={{ perspective: '1100px' }}
      className="flex items-center justify-center p-3 select-none"
    >
      <div
        ref={cardRef}
        onPointerMove={handlePointerMove}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={handlePointerLeave}
        style={{
          transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(${isHovered ? 1.02 : 1}, ${isHovered ? 1.02 : 1}, 1)`,
          transition: isHovered ? 'transform 0.08s ease-out' : 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)',
          transformStyle: 'preserve-3d',
        }}
        className={`relative w-full max-w-[340px] aspect-[4/5.4] rounded-[28px] overflow-hidden bg-[#0a0a14] p-5.5 border ${getBorderGlow()} cursor-grab active:cursor-grabbing transition-shadow duration-300`}
      >
        {/* Holographic Reflection Glare Layer */}
        <div
          className="pointer-events-none absolute inset-0 mix-blend-color-dodge transition-opacity duration-300"
          style={{
            background: getFoilOverlay(),
            opacity: isHovered ? 0.95 : 0.75,
          }}
        />

        {/* Card Header */}
        <div className="relative z-10 flex items-center justify-between pb-3 border-b border-[rgba(255,255,255,0.12)]">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-mint to-cyan-400 text-black font-extrabold text-[13px] shadow-[0_0_12px_rgba(54,223,166,0.5)]">
              f(x)
            </span>
            <div>
              <span className="block text-[13px] font-black tracking-wider text-white uppercase">
                FxAeon Protocol
              </span>
              <span className="block text-[9.5px] font-mono text-mut">Verified On-Chain Trade</span>
            </div>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-[rgba(255,255,255,0.08)] px-2.5 py-1 text-[10px] font-bold text-mint uppercase tracking-wider backdrop-blur-md">
            <Sparkles className="h-3 w-3 animate-spin" style={{ animationDuration: '4s' }} />
            {foil.toUpperCase()}
          </span>
        </div>

        {/* Big PnL Display */}
        <div className="relative z-10 my-4 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.06)] px-3 py-1 text-[11.5px] font-extrabold uppercase tracking-widest text-white backdrop-blur-md">
            <span className={side === 'long' ? 'text-success' : 'text-danger'}>
              {side.toUpperCase()}
            </span>
            <span>·</span>
            <span className="text-mint">{leverage.toFixed(1)}× LEVERAGE</span>
          </div>

          <div className="mt-2.5">
            <span
              className={`text-display block text-[42px] font-black tracking-tight drop-shadow-[0_4px_24px_rgba(54,223,166,0.4)] ${
                isProfit ? 'text-success' : 'text-danger'
              }`}
            >
              {isProfit ? '+' : ''}
              {pnlPct.toFixed(1)}%
            </span>
            <span className="block font-mono text-[16px] font-bold text-white/90">
              {isProfit ? '+$' : '-$'}
              {Math.abs(pnlUsd).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Position Metadata Matrix */}
        <div className="relative z-10 my-3 grid grid-cols-2 gap-2 rounded-2xl bg-[rgba(0,0,0,0.5)] p-3 border border-[rgba(255,255,255,0.08)] backdrop-blur-md text-[11px]">
          <div>
            <span className="block text-[9.5px] text-mut uppercase font-semibold">Asset Market</span>
            <span className="font-bold text-white text-[12px]">{market} / fxUSD</span>
          </div>
          <div>
            <span className="block text-[9.5px] text-mut uppercase font-semibold">Execution Price</span>
            <span className="font-mono font-bold text-white text-[12px]">${entryPrice.toLocaleString('en-US')}</span>
          </div>
          <div>
            <span className="block text-[9.5px] text-mut uppercase font-semibold">Current Mark</span>
            <span className="font-mono font-bold text-mint text-[12px]">${currentPrice.toLocaleString('en-US')}</span>
          </div>
          <div>
            <span className="block text-[9.5px] text-mut uppercase font-semibold">Pilot Rank</span>
            <span className="font-bold text-warn text-[12px]">Apex f(x)oor 🎖️</span>
          </div>
        </div>

        {/* Card Footer with Verified Referral */}
        <div className="relative z-10 mt-auto flex items-center justify-between pt-2 border-t border-[rgba(255,255,255,0.1)]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-mint" />
            <span className="text-[10px] font-bold text-white/90">{traderName}</span>
          </div>
          <span className="font-mono text-[9.5px] font-bold text-mint bg-mint/10 px-2 py-0.5 rounded-md">
            Ref: {referralCode}
          </span>
        </div>
      </div>
    </div>
  );
}
