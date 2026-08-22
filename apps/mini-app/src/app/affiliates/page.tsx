'use client';

import { useState } from 'react';
import {
  Check,
  Copy,
  Crown,
  Gift,
  Send,
} from 'lucide-react';
import { AppShell, Button, Card, copyText } from '@/components/ui';
import { getWebApp, haptic } from '@/lib/telegram';
import { sound } from '@/lib/sound';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

export default function AffiliatesPage() {
  const [copied, setCopied] = useState(false);
  const [claimed, setClaimed] = useState(false);

  const myRefCode = '0x742d...f44e';
  const refUrl = `https://t.me/${BOT_USERNAME}/app?startapp=ref_${myRefCode}`;

  const handleCopy = async () => {
    sound.tap();
    haptic('success');
    if (await copyText(refUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShareTelegram = () => {
    sound.confirm();
    haptic('medium');
    const shareText = `Trade on @${BOT_USERNAME} — the self-custodial f(x) Protocol gateway on Telegram! Use my invite link for a fee discount:`;
    const fullUrl = `https://t.me/share/url?url=${encodeURIComponent(refUrl)}&text=${encodeURIComponent(shareText)}`;

    const webapp = getWebApp();
    if (webapp?.openTelegramLink) {
      webapp.openTelegramLink(fullUrl);
    } else {
      window.open(fullUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleClaim = () => {
    sound.success();
    haptic('success');
    setClaimed(true);
  };

  return (
    <AppShell title="Affiliate Arena" subtitle="Earn up to 30% perpetual trading fee rebates on all referred volume.">
      <div className="stagger flex flex-col gap-3.5">
        {/* VIP Rank Hero */}
        <Card glow className="relative overflow-hidden p-5 border border-mint/20">
          <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-[rgba(54,223,166,.18)] blur-3xl" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[18px]">🥈</span>
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mint">
                  VIP Tier 2 Ambassador
                </span>
              </div>
              <h2 className="text-display mt-1 text-[22px] font-bold">20% Fee Rebate</h2>
              <p className="mt-0.5 text-[11.5px] text-mut">Perpetual lifetime earnings on referred trades</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint shadow-[0_0_20px_var(--mint-glow)]">
              <Crown className="h-6 w-6" />
            </div>
          </div>

          {/* Key Metrics */}
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-[rgba(255,255,255,0.04)] p-3 text-center">
            <div>
              <span className="block text-[9.5px] text-mut uppercase">Referrals</span>
              <span className="text-display text-[15px] font-bold text-white">14</span>
            </div>
            <div>
              <span className="block text-[9.5px] text-mut uppercase">Referred Volume</span>
              <span className="text-display text-[15px] font-bold text-white">$68.4k</span>
            </div>
            <div>
              <span className="block text-[9.5px] text-mut uppercase">Claimable</span>
              <span className="text-display text-[15px] font-bold text-success">$142.50</span>
            </div>
          </div>

          <div className="mt-3">
            {claimed ? (
              <div className="text-center text-[12px] font-bold text-success py-1.5 bg-success/10 rounded-xl">
                ✔ $142.50 fxUSD Claimed to Wallet
              </div>
            ) : (
              <Button onClick={handleClaim} className="w-full gap-2 text-[12.5px]">
                <Gift className="h-4 w-4" /> Claim $142.50 fxUSD Rebate
              </Button>
            )}
          </div>
        </Card>

        {/* Share Link Station */}
        <Card className="p-4.5 space-y-3">
          <label className="text-[11px] font-semibold text-mut uppercase tracking-wider block">
            Your Viral Referral Link
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={refUrl}
              className="w-full truncate rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[12px] font-mono text-white focus:outline-none"
            />
            <Button variant="ghost" onClick={handleCopy} className="shrink-0 text-[12px]">
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <Button onClick={handleShareTelegram} className="w-full gap-2 text-[13px]">
            <Send className="h-4 w-4" /> Share Invite to Telegram Chat
          </Button>
        </Card>

        {/* VIP Tier Progression Matrix */}
        <div>
          <h2 className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mut">
            VIP Rebate Tier Matrix
          </h2>

          <div className="flex flex-col gap-2">
            <div className="glass flex items-center justify-between p-3">
              <div className="flex items-center gap-2.5">
                <span className="text-[18px]">🥉</span>
                <div>
                  <span className="font-bold text-[13px] text-white">Tier 1: Bronze Pilot</span>
                  <span className="block text-[10.5px] text-mut">0 - $25,000 referred volume</span>
                </div>
              </div>
              <span className="font-mono text-[13px] font-bold text-mint">10% Rebate</span>
            </div>

            <div className="glass flex items-center justify-between p-3 border-mint/30 shadow-[0_0_10px_rgba(54,223,166,0.1)]">
              <div className="flex items-center gap-2.5">
                <span className="text-[18px]">🥈</span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-[13px] text-white">Tier 2: Silver Ambassador</span>
                    <span className="rounded-full bg-mint/20 px-1.5 py-0.2 text-[9px] font-bold text-mint">CURRENT</span>
                  </div>
                  <span className="block text-[10.5px] text-mut">$25,000 - $100,000 volume</span>
                </div>
              </div>
              <span className="font-mono text-[13px] font-bold text-mint">20% Rebate</span>
            </div>

            <div className="glass flex items-center justify-between p-3">
              <div className="flex items-center gap-2.5">
                <span className="text-[18px]">🥇</span>
                <div>
                  <span className="font-bold text-[13px] text-white">Tier 3: Gold Whale Partner</span>
                  <span className="block text-[10.5px] text-mut">$100,000+ volume</span>
                </div>
              </div>
              <span className="font-mono text-[13px] font-bold text-mint">30% Rebate</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
