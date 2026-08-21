'use client';

import { ArrowLeftRight, X } from 'lucide-react';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';
import { Button } from '@/components/ui';
import type { ApiPosition } from '@/lib/api';

interface PositionFlipModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: ApiPosition;
  onConfirmFlip: (position: ApiPosition) => void;
}

export function PositionFlipModal({
  isOpen,
  onClose,
  position,
  onConfirmFlip,
}: PositionFlipModalProps) {
  if (!isOpen) return null;

  const targetSide = position.side === 'long' ? 'short' : 'long';
  const token = position.collateralToken || position.market;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
    >
      <div className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
              <ArrowLeftRight className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-display text-[16px] font-bold">Flip Position</h3>
              <p className="text-[11px] text-mut">Instant atomic side reversal</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              sound.tap();
              onClose();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.06)] text-mut hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Side-by-Side Flip Comparison */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {/* Current State */}
          <div className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-3">
            <span className="text-[10px] uppercase font-bold tracking-wider text-mut">Current</span>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[14px] font-bold">{position.market}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                  position.side === 'long'
                    ? 'bg-[var(--success-dim)] text-success'
                    : 'bg-[var(--danger-dim)] text-danger'
                }`}
              >
                {position.side}
              </span>
            </div>
            <p className="mt-1 font-mono text-[13px] font-semibold text-mut">
              {position.leverage.toFixed(1)}x · {position.collateral ?? '—'} {token}
            </p>
          </div>

          {/* Flipped Target State */}
          <div className="rounded-2xl border border-[var(--mint)] bg-[var(--mint-dim)] p-3">
            <span className="text-[10px] uppercase font-bold tracking-wider text-mint">Flipped</span>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[14px] font-bold">{position.market}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                  targetSide === 'long'
                    ? 'bg-[var(--success-dim)] text-success'
                    : 'bg-[var(--danger-dim)] text-danger'
                }`}
              >
                {targetSide}
              </span>
            </div>
            <p className="mt-1 font-mono text-[13px] font-semibold text-white">
              {position.leverage.toFixed(1)}x · {position.collateral ?? '—'} {token}
            </p>
          </div>
        </div>

        {/* Explanation Note */}
        <div className="mt-4 rounded-xl bg-[rgba(255,255,255,0.03)] p-3 text-[11.5px] leading-relaxed text-mut">
          Reverses your exposure immediately. Closes the current {position.side} position and opens a matching{' '}
          <strong className="text-white">{targetSide}</strong> position with identical leverage.
        </div>

        {/* Action Buttons */}
        <div className="mt-5 flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              sound.tap();
              onClose();
            }}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              sound.confirm();
              haptic('heavy');
              onConfirmFlip(position);
              onClose();
            }}
            className="flex-1"
          >
            <ArrowLeftRight className="h-4 w-4" /> Confirm Flip
          </Button>
        </div>
      </div>
    </div>
  );
}
