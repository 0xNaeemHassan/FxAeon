'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Send,
  Share2,
  X,
} from 'lucide-react';
import FxLogo from '@/components/FxLogo';
import { Button, Card, copyText } from '@/components/ui';
import { getWebApp, haptic } from '@/lib/telegram';

export interface PnLData {
  market: string;
  side: 'long' | 'short';
  leverage: number;
  pnlUsd?: number | null;
  pnlPct?: number | null;
  entryPrice?: number | null;
  currentPrice?: number | null;
  size?: string;
  referralCode?: string;
}

interface SharePnLModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: PnLData;
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

export function SharePnLModal({ isOpen, onClose, data }: SharePnLModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const isProfit = (data.pnlPct ?? data.pnlUsd ?? 0) >= 0;
  const pnlPctFormatted = data.pnlPct !== undefined && data.pnlPct !== null
    ? `${data.pnlPct >= 0 ? '+' : ''}${data.pnlPct.toFixed(2)}%`
    : null;
  const pnlUsdFormatted = data.pnlUsd !== undefined && data.pnlUsd !== null
    ? `${data.pnlUsd >= 0 ? '+' : '-'}$${Math.abs(data.pnlUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

  // Render high-DPI Card to Canvas
  const drawCardToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 800;
    const height = 500;
    canvas.width = width * 2; // 2x retina scale
    canvas.height = height * 2;
    ctx.scale(2, 2);

    // Background Dark OLED Gradient
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, '#0c0c16');
    bgGradient.addColorStop(0.5, '#07070d');
    bgGradient.addColorStop(1, '#0e0b1c');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Ambient Aurora Glow
    const glow = ctx.createRadialGradient(width * 0.8, 0, 10, width * 0.8, 0, 380);
    glow.addColorStop(0, isProfit ? 'rgba(54, 223, 166, 0.22)' : 'rgba(255, 107, 118, 0.22)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Card border
    ctx.strokeStyle = isProfit ? 'rgba(54, 223, 166, 0.35)' : 'rgba(255, 107, 118, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(16, 16, width - 32, height - 32, 24);
    ctx.stroke();

    // Top Header: Logo + Brand
    ctx.fillStyle = '#8b6dff';
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('FXAEON PROTOCOL GATEWAY', 44, 56);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
    ctx.letterSpacing = '-0.5px';
    ctx.fillText('FxAeon', 44, 90);

    // Badge: Market & Side & Leverage
    const badgeText = `${data.market} ${data.side.toUpperCase()} ${data.leverage % 1 === 0 ? data.leverage : data.leverage.toFixed(1)}X`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.roundRect(width - 240, 42, 196, 42, 14);
    ctx.fill();

    ctx.fillStyle = isProfit ? '#36dfa6' : '#ff6b76';
    ctx.font = 'bold 15px monospace, system-ui';
    ctx.fillText(badgeText, width - 224, 68);

    // Middle Hero: PnL Display
    ctx.fillStyle = '#a7a6bd';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('RETURN ON INVESTMENT (PnL)', 44, 160);

    ctx.fillStyle = isProfit ? '#36dfa6' : '#ff6b76';
    ctx.font = 'bold 68px system-ui, -apple-system, sans-serif';
    ctx.letterSpacing = '-2px';
    const mainPnlText = pnlPctFormatted ?? pnlUsdFormatted ?? `${data.leverage}X ACTIVE`;
    ctx.fillText(mainPnlText, 44, 235);

    if (pnlUsdFormatted && pnlPctFormatted) {
      ctx.fillStyle = isProfit ? 'rgba(54, 223, 166, 0.85)' : 'rgba(255, 107, 118, 0.85)';
      ctx.font = '600 24px monospace, system-ui';
      ctx.fillText(`(${pnlUsdFormatted})`, 44, 280);
    }

    // Grid Metrics (Bottom Panel)
    const metricsY = 350;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    ctx.roundRect(44, metricsY, width - 88, 86, 18);
    ctx.fill();

    // Metric 1: Entry
    ctx.fillStyle = '#8b8a9f';
    ctx.font = '11px system-ui';
    ctx.fillText('POSITION TYPE', 68, metricsY + 32);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`${data.market} · ${data.side.toUpperCase()}`, 68, metricsY + 58);

    // Metric 2: Leverage
    ctx.fillStyle = '#8b8a9f';
    ctx.font = '11px system-ui';
    ctx.fillText('LEVERAGE', 320, metricsY + 32);
    ctx.fillStyle = '#aa96ff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`${data.leverage.toFixed(1)}x`, 320, metricsY + 58);

    // Metric 3: Protocol
    ctx.fillStyle = '#8b8a9f';
    ctx.font = '11px system-ui';
    ctx.fillText('SELF-CUSTODIAL', 540, metricsY + 32);
    ctx.fillStyle = '#36dfa6';
    ctx.font = 'bold 16px system-ui';
    ctx.fillText('f(x) Protocol', 540, metricsY + 58);

    // Footer
    ctx.fillStyle = '#7a7894';
    ctx.font = '12px system-ui';
    ctx.fillText(`Trade decentralized perpetuals on Telegram · @${BOT_USERNAME}`, 44, height - 28);

    if (data.referralCode) {
      ctx.fillStyle = '#aa96ff';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`Ref: ${data.referralCode}`, width - 170, height - 28);
    }
  }, [data, isProfit, pnlPctFormatted, pnlUsdFormatted]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(drawCardToCanvas, 100);
    }
  }, [isOpen, drawCardToCanvas]);

  const handleDownload = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setDownloading(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `FxAeon-${data.market}-${data.side}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      haptic('success');
    } catch {
      haptic('error');
    } finally {
      setDownloading(false);
    }
  };

  const handleShareTelegram = () => {
    haptic('medium');
    const shareText = `Check out my ${data.market} ${data.side.toUpperCase()} (${data.leverage}x) on @${BOT_USERNAME}!` +
      (pnlPctFormatted ? ` ROI: ${pnlPctFormatted}` : '') +
      (data.referralCode ? ` Referral code: ${data.referralCode}` : '');

    const shareUrl = `https://t.me/${BOT_USERNAME}`;
    const fullUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;

    const webapp = getWebApp();
    if (webapp?.openTelegramLink) {
      webapp.openTelegramLink(fullUrl);
    } else {
      window.open(fullUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleShareStory = () => {
    haptic('medium');
    const webapp = getWebApp();
    const shareText = `Trading on @${BOT_USERNAME} · f(x) Protocol Gateway`;
    const widgetUrl = `https://t.me/${BOT_USERNAME}/app`;

    if (webapp?.shareToStory) {
      // Telegram native story share API
      webapp.shareToStory('https://fxaeon.app/icon.svg', {
        text: shareText,
        widget_link: { url: widgetUrl, name: 'FxAeon' },
      });
    } else {
      handleShareTelegram();
    }
  };

  const handleCopy = async () => {
    const shareText = `FxAeon ${data.market} ${data.side.toUpperCase()} (${data.leverage}x) position` +
      (pnlPctFormatted ? ` | PnL: ${pnlPctFormatted}` : '') +
      ` | Built on f(x) Protocol | t.me/${BOT_USERNAME}`;

    if (await copyText(shareText)) {
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-sm rounded-[28px] border border-[var(--line-strong)] bg-[var(--bg-raised)] p-5 shadow-2xl anim-scale-in">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close share dialog"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-mut transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Modal Header */}
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint">
            <Share2 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-[16px] font-semibold">Share Position Card</h3>
            <p className="text-[11px] text-mut">Share your trade badge on Telegram or Stories</p>
          </div>
        </div>

        {/* Live Visual Card Preview */}
        <Card
          glow
          className={`relative overflow-hidden border p-4.5 ${
            isProfit ? 'border-success/40' : 'border-danger/40'
          }`}
        >
          <div
            className={`pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full blur-3xl ${
              isProfit ? 'bg-[rgba(54,223,166,0.18)]' : 'bg-[rgba(255,107,118,0.18)]'
            }`}
          />

          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FxLogo size={24} />
                <span className="text-[12px] font-bold tracking-wider text-mint">FxAeon</span>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${
                  isProfit ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--danger-dim)] text-danger'
                }`}
              >
                {data.side === 'long' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {data.market} {data.leverage}x
              </span>
            </div>

            <div className="my-4">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mut">
                Position PnL
              </span>
              <p
                className={`text-display mt-0.5 text-[32px] font-bold leading-none tracking-tight ${
                  isProfit ? 'text-success' : 'text-danger'
                }`}
              >
                {pnlPctFormatted ?? pnlUsdFormatted ?? `${data.leverage}x Leverage`}
              </p>
              {pnlUsdFormatted && pnlPctFormatted && (
                <p className="mt-1 text-[13px] font-medium text-mut">{pnlUsdFormatted}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl bg-[rgba(255,255,255,0.04)] p-2.5 text-[11px]">
              <div>
                <span className="block text-[9px] uppercase tracking-wider text-mut">Market</span>
                <span className="font-semibold">{data.market}</span>
              </div>
              <div>
                <span className="block text-[9px] uppercase tracking-wider text-mut">Protocol</span>
                <span className="font-semibold text-mint">f(x) Gateway</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Hidden Canvas for High-Resolution Generation */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Actions Grid */}
        <div className="mt-4 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={handleShareTelegram} className="gap-1.5 text-[12.5px]">
              <Send className="h-3.5 w-3.5" /> Share Chat
            </Button>
            <Button onClick={handleShareStory} variant="ghost" className="gap-1.5 text-[12.5px] border border-[var(--mint-dim)] text-mint">
              <Share2 className="h-3.5 w-3.5" /> Post Story
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={handleDownload} loading={downloading} className="text-[12.5px]">
              <Download className="h-3.5 w-3.5" /> Save Image
            </Button>
            <Button variant="ghost" onClick={handleCopy} className="text-[12.5px]">
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy Text'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
