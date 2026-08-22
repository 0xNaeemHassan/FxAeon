'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  KeyRound,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

const STORAGE_KEY = 'fxaeon_onboarded_tour_v1';

export function OnboardingModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      const onboarded = localStorage.getItem(STORAGE_KEY);
      if (!onboarded) {
        setIsOpen(true);
      }
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const handleClose = () => {
    sound.confirm();
    haptic('medium');
    setIsOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
  };

  const handleNext = () => {
    sound.tap();
    haptic('selection');
    if (step < 2) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  };

  if (!isOpen) return null;

  const SLIDES = [
    {
      badge: 'Zero-Popup Speed',
      title: 'Self-Custodial Session Signers',
      desc: 'Trade instantly with Privy Session Delegation. Authorize once and execute 10× leverage trades with zero repetitive signing popups while maintaining 100% non-custodial ownership.',
      icon: <KeyRound className="h-8 w-8 text-mint animate-pulse" />,
      features: [
        'Default-deny security guardrails',
        'Direct on-chain execution on Ethereum & Base',
        'Export private keys anytime',
      ],
    },
    {
      badge: 'Pro Intelligence',
      title: '60fps Terminal & Strategy Hub',
      desc: 'Access institutional-grade DeFi intelligence directly in Telegram without paying for third-party tools.',
      icon: <TrendingUp className="h-8 w-8 text-cyan animate-pulse" />,
      features: [
        'Live Canvas 2D chart with TP/SL simulators',
        'Stability Arb Radar for 1:1 fxUSD peg discounts',
        'Whale Watcher with 1-tap copy trading',
      ],
    },
    {
      badge: 'Viral Flex Culture',
      title: '3D Holo Cards & Cyberpunk Voice',
      desc: 'Elevate your trading experience with interactive holographic PnL cards and real-time offline voice commentary.',
      icon: <Sparkles className="h-8 w-8 text-warn animate-pulse" />,
      features: [
        '3D Gyroscope PnL cards responding to phone tilt',
        'Offline AI Voice Announcer for trade fills & alerts',
        '3-Tier VIP Affiliate Arena with 30% lifetime rebates',
      ],
    },
  ];

  const current = SLIDES[step];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md anim-fade"
    >
      <div className="relative w-full max-w-[380px] rounded-[28px] bg-[#0c0c16] border border-[var(--astryx-border-strong)] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.85)] astryx-card-elevated overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-48 rounded-full bg-mint/20 blur-3xl" />

        {/* Header with Skip Button */}
        <div className="relative z-10 flex items-center justify-between pb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mint/15 px-3 py-1 text-[10.5px] font-extrabold uppercase tracking-wider text-mint border border-mint/30">
            <Zap className="h-3 w-3" />
            {current.badge}
          </span>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close tour"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-mut hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Icon & Title */}
        <div className="relative z-10 my-4 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 shadow-[0_0_20px_rgba(139,109,255,0.25)]">
            {current.icon}
          </div>
          <h2 id="onboarding-title" className="text-display text-[21px] font-bold text-white leading-tight">
            {current.title}
          </h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mut">
            {current.desc}
          </p>
        </div>

        {/* Feature Highlights Checklist */}
        <div className="relative z-10 my-4 space-y-2 rounded-xl bg-black/40 p-3.5 border border-white/5 text-[11.5px]">
          {current.features.map((feat) => (
            <div key={feat} className="flex items-center gap-2 text-white/90">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/20 text-success">
                <Check className="h-2.5 w-2.5" />
              </span>
              <span>{feat}</span>
            </div>
          ))}
        </div>

        {/* Step Dots & Action Button */}
        <div className="relative z-10 mt-6 flex items-center justify-between gap-4 pt-2">
          {/* Step Indicator Dots */}
          <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of 3`}>
            {[0, 1, 2].map((idx) => (
              <span
                key={idx}
                className={`h-2 rounded-full transition-all duration-300 ${
                  step === idx ? 'w-6 bg-mint' : 'w-2 bg-white/20'
                }`}
              />
            ))}
          </div>

          <Button
            onClick={handleNext}
            className="flex-1 gap-2 text-[13.5px]"
          >
            {step === 2 ? 'Launch Terminal 🚀' : 'Next'}
            {step < 2 && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
