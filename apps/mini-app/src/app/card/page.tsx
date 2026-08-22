'use client';

import { useState } from 'react';
import {
  Send,
  Volume2,
} from 'lucide-react';
import { AppShell, Button, Card } from '@/components/ui';
import { HoloCard, type FoilTheme } from '@/components/HoloCard';
import { announcer } from '@/lib/announcer';
import { sound } from '@/lib/sound';
import { getWebApp, haptic } from '@/lib/telegram';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

export default function HoloCardStudioPage() {
  const [foil, setFoil] = useState<FoilTheme>('rainbow');
  const [market, setMarket] = useState('wstETH');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [leverage, setLeverage] = useState(5.0);
  const [pnlPct, setPnlPct] = useState(128.4);
  const [pnlUsd, setPnlUsd] = useState(3850.0);

  const handleFoilSelect = (f: FoilTheme) => {
    sound.tap();
    haptic('selection');
    setFoil(f);
  };

  const handlePresetSelect = (pct: number, usd: number, lev: number) => {
    sound.confirm();
    haptic('medium');
    setPnlPct(pct);
    setPnlUsd(usd);
    setLeverage(lev);
  };

  const handleVoiceFlex = () => {
    sound.success();
    haptic('success');
    announcer.announceTakeProfit(pnlPct, pnlUsd);
  };

  const handleShareStory = () => {
    sound.confirm();
    haptic('medium');
    const webapp = getWebApp();
    const shareText = `🚀 Printed +${pnlPct.toFixed(1)}% on ${market} with @${BOT_USERNAME}!`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${BOT_USERNAME}/app?startapp=ref_0x742d`)}&text=${encodeURIComponent(shareText)}`;

    if (webapp?.openTelegramLink) {
      webapp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <AppShell title="3D Holo Card Studio" subtitle="Interactive holographic gyroscope brag cards for Telegram.">
      <div className="stagger flex flex-col gap-3.5 items-center">
        {/* Holographic 3D Card Display */}
        <div className="w-full flex justify-center py-2">
          <HoloCard
            market={market}
            side={side}
            leverage={leverage}
            pnlPct={pnlPct}
            pnlUsd={pnlUsd}
            entryPrice={market === 'wstETH' ? 3350 : 64200}
            currentPrice={market === 'wstETH' ? 3540 : 67800}
            foil={foil}
            traderName="anon.f(x)oor"
            referralCode="0x742d...f44e"
          />
        </div>

        <p className="text-[11px] text-mut text-center italic">
          💡 Drag card or tilt your mobile device to rotate in 3D with realistic holographic glare!
        </p>

        {/* Foil Texture Selector */}
        <Card className="w-full p-4 space-y-3">
          <label className="text-[10.5px] font-semibold text-mut uppercase tracking-wider block">
            Holographic Foil Texture
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { id: 'rainbow', name: 'Rainbow', icon: '🌈' },
                { id: 'gold', name: 'Giga Gold', icon: '👑' },
                { id: 'cyber', name: 'Cyber Neon', icon: '⚡' },
                { id: 'darkmatter', name: 'Dark Matter', icon: '🌌' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleFoilSelect(item.id)}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all ${
                  foil === item.id
                    ? 'border-mint bg-mint/15 text-white shadow-[0_0_12px_var(--mint-glow)]'
                    : 'border-[var(--line)] bg-[rgba(255,255,255,0.03)] text-mut hover:text-white'
                }`}
              >
                <span className="text-[18px]">{item.icon}</span>
                <span className="text-[10.5px] font-bold mt-1">{item.name}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Quick PnL Presets */}
        <Card className="w-full p-4 space-y-3">
          <label className="text-[10.5px] font-semibold text-mut uppercase tracking-wider block">
            Select PnL Tier
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: '+45%', pct: 45.2, usd: 850, lev: 3.0 },
              { label: '+128%', pct: 128.4, usd: 3850, lev: 5.0 },
              { label: '+350%', pct: 350.0, usd: 10500, lev: 8.0 },
              { label: '+1000%', pct: 1000.0, usd: 30000, lev: 10.0 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => handlePresetSelect(p.pct, p.usd, p.lev)}
                className={`py-2 rounded-xl text-[12px] font-mono font-bold transition-all ${
                  pnlPct === p.pct
                    ? 'bg-success text-black shadow-[0_0_12px_rgba(54,223,166,0.6)]'
                    : 'bg-[rgba(255,255,255,0.04)] text-mut hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Card>

        {/* Market & Side Selectors */}
        <Card className="w-full p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-mut uppercase tracking-wider block mb-1">
                Asset Market
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['wstETH', 'WBTC'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      sound.tap();
                      haptic('selection');
                      setMarket(m);
                    }}
                    className={`py-1.5 rounded-lg text-[12px] font-bold transition-all ${
                      market === m ? 'bg-mint text-black' : 'bg-white/5 text-mut'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-mut uppercase tracking-wider block mb-1">
                Position Side
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['long', 'short'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      sound.tap();
                      haptic('selection');
                      setSide(s);
                    }}
                    className={`py-1.5 rounded-lg text-[12px] font-bold uppercase transition-all ${
                      side === s
                        ? s === 'long'
                          ? 'bg-success text-black'
                          : 'bg-danger text-white'
                        : 'bg-white/5 text-mut'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Actions Grid */}
        <div className="w-full grid grid-cols-2 gap-2.5">
          <Button onClick={handleVoiceFlex} variant="ghost" className="gap-2 text-[12.5px] text-mint">
            <Volume2 className="h-4 w-4" /> AI Voice Flex
          </Button>
          <Button onClick={handleShareStory} className="gap-2 text-[12.5px]">
            <Send className="h-4 w-4" /> Share to Telegram
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
