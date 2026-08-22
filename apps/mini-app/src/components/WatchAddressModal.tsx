'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Eye,
  Search,
  X,
} from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

interface WatchAddressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAddress?: (address: string) => void;
}

const QUICK_WHALES = [
  { name: 'Apex Whale #1', address: '0x3b89f5c4210a8d910bc44e99214e91023a19e481', tag: '$145k wstETH 7.5x' },
  { name: 'Stability Whale #2', address: '0x991a0c77fe1299ab44fe88102391ac8844fe2291', tag: '$250k fxUSD Mint' },
  { name: 'vitalik.eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', tag: 'Ethereum Pioneer' },
];

export function WatchAddressModal({ isOpen, onClose, onSelectAddress }: WatchAddressModalProps) {
  const [inputAddress, setInputAddress] = useState('');
  const [inspectedData, setInspectedData] = useState<{
    address: string;
    totalValueUsd: number;
    collateralUsd: number;
    debtUsd: number;
    healthPercent: number;
    positionsCount: number;
  } | null>(null);

  if (!isOpen) return null;

  const handleInspect = (addr: string) => {
    sound.confirm();
    haptic('medium');
    const target = addr.trim() || '0x3b89f5c4210a8d910bc44e99214e91023a19e481';

    // Simulate inspection snapshot
    setInspectedData({
      address: target,
      totalValueUsd: 145200,
      collateralUsd: 145200,
      debtUsd: 92400,
      healthPercent: 78,
      positionsCount: 2,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-sm rounded-[28px] border border-[var(--line-strong)] bg-[var(--bg-raised)] p-5 shadow-2xl anim-scale-in">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-mut transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
            <Eye className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-[16px] font-semibold">Whale Mirror (Watch Mode)</h3>
            <p className="text-[11px] text-mut">Inspect any address or ENS in real-time</p>
          </div>
        </div>

        {/* Input Bar */}
        <div className="space-y-3">
          <div className="relative">
            <input
              type="text"
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder="Enter 0x address or ENS (e.g. vitalik.eth)"
              className="w-full rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-3 py-2.5 pl-9 text-[12.5px] font-mono focus:border-mint focus:outline-none"
            />
            <Search className="absolute left-3 top-3 h-3.5 w-3.5 text-mut" />
          </div>

          <Button onClick={() => handleInspect(inputAddress)} className="w-full gap-2 text-[13px]">
            <Eye className="h-4 w-4" /> Inspect Portfolio
          </Button>

          {/* Quick Presets */}
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-mut mb-1.5 font-bold">
              Quick Whale Profiles
            </span>
            <div className="flex flex-col gap-1.5">
              {QUICK_WHALES.map((whale) => (
                <button
                  key={whale.name}
                  type="button"
                  onClick={() => {
                    setInputAddress(whale.address);
                    handleInspect(whale.address);
                  }}
                  className="glass flex items-center justify-between p-2 text-left transition-colors hover:border-mint"
                >
                  <div>
                    <span className="block text-[12px] font-semibold text-white">{whale.name}</span>
                    <span className="font-mono text-[10px] text-mut">{whale.address.slice(0, 10)}...</span>
                  </div>
                  <span className="rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[9.5px] font-bold text-mint">
                    {whale.tag}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Inspection Result Snapshot */}
          {inspectedData && (
            <Card glow className="mt-3 p-3.5 border border-mint/30 animate-in fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
                <span className="text-[11px] font-bold text-mint">Live Mirror Active</span>
                <span className="font-mono text-[10px] text-mut">{inspectedData.address.slice(0, 8)}...</span>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11.5px]">
                <div>
                  <span className="block text-[9.5px] text-mut">Total Collateral</span>
                  <span className="font-mono font-bold text-white">
                    ${inspectedData.totalValueUsd.toLocaleString('en-US')}
                  </span>
                </div>
                <div>
                  <span className="block text-[9.5px] text-mut">Health Ratio</span>
                  <span className="font-mono font-bold text-success">
                    {inspectedData.healthPercent}% Healthy
                  </span>
                </div>
              </div>

              <Link
                href="/positions"
                onClick={() => {
                  onClose();
                  onSelectAddress?.(inspectedData.address);
                }}
                className="mt-3 block"
              >
                <Button variant="ghost" className="w-full gap-1 text-[12px] text-mint">
                  View Whale Positions <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
