'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Mic, MicOff, Terminal, X } from 'lucide-react';
import { sound } from '@/lib/sound';
import { haptic } from '@/lib/telegram';

export interface ParsedTradeCommand {
  market?: 'wstETH' | 'WBTC';
  side?: 'long' | 'short';
  leverage?: number;
  amount?: string;
}

interface QuickCommandBarProps {
  onApplyTrade?: (trade: ParsedTradeCommand) => void;
}

export function parseLocalIntent(raw: string): ParsedTradeCommand | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  const res: ParsedTradeCommand = {};

  // Detect Side
  if (/\b(long|buy)\b/i.test(text)) res.side = 'long';
  else if (/\b(short|sell)\b/i.test(text)) res.side = 'short';

  // Detect Market
  if (/\b(btc|bitcoin|wbtc)\b/i.test(text)) {
    res.market = 'WBTC';
  } else if (/\b(eth|ethereum|wsteth|steth)\b/i.test(text)) {
    res.market = 'wstETH';
  }

  // Extract Leverage first and remove from remainder
  let remainder = text;
  const levMatch = remainder.match(/(\d+(?:\.\d+)?)\s*x\b/i);
  if (levMatch && levMatch[1]) {
    const lev = parseFloat(levMatch[1]);
    if (!Number.isNaN(lev) && lev >= 1 && lev <= 10) {
      res.leverage = lev;
      remainder = remainder.replace(levMatch[0], ' ');
    }
  }

  // Extract Amount from remainder
  const amtMatch = remainder.match(/\$?\s*(\d+(?:\.\d+)?)\b/);
  if (amtMatch && amtMatch[1]) {
    const amt = parseFloat(amtMatch[1]);
    if (!Number.isNaN(amt) && amt > 0) res.amount = amtMatch[1];
  }

  return res.side || res.market || res.leverage || res.amount ? res : null;
}

export function QuickCommandBar({ onApplyTrade }: QuickCommandBarProps) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const win = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
      setRecognitionSupported(Boolean(win.SpeechRecognition || win.webkitSpeechRecognition));
    }
  }, []);

  const handleVoiceInput = useCallback(() => {
    sound.tap();
    haptic('medium');

    const win = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) return;

    try {
      const recognition = new SpeechRec();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        sound.toggle();
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        if (transcript) {
          setInput(transcript);
          const parsed = parseLocalIntent(transcript);
          if (parsed && onApplyTrade) {
            sound.confirm();
            onApplyTrade(parsed);
          }
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
        sound.error();
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch {
      setIsListening(false);
    }
  }, [onApplyTrade]);

  const executeCommand = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const lower = input.toLowerCase().trim();

    // Quick navigation commands
    if (lower.includes('deposit') || lower.includes('qr')) {
      sound.confirm();
      router.push('/qr');
      return;
    }
    if (lower.includes('bridge') || lower.includes('move')) {
      sound.confirm();
      router.push('/move');
      return;
    }
    if (lower.includes('borrow')) {
      sound.confirm();
      router.push('/borrow');
      return;
    }
    if (lower.includes('earn') || lower.includes('save')) {
      sound.confirm();
      router.push('/earn');
      return;
    }
    if (lower.includes('position')) {
      sound.confirm();
      router.push('/positions');
      return;
    }

    // Trade Intent Parsing
    const parsed = parseLocalIntent(input);
    if (parsed) {
      sound.confirm();
      haptic('light');
      onApplyTrade?.(parsed);
      setInput('');
    } else {
      sound.error();
    }
  };

  return (
    <form onSubmit={executeCommand} className="relative flex w-full items-center">
      <div className="relative flex w-full items-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 transition-all focus-within:border-[var(--mint)] focus-within:shadow-[0_0_15px_var(--mint-glow)]">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center text-mut">
          <Terminal className="h-4 w-4" />
        </div>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isListening ? 'Listening… say "Long ETH 3x 500"' : 'Type or speak "Long ETH 3x 500"'}
          className="mx-2 w-full bg-transparent text-[12.5px] text-white outline-none placeholder:text-mut"
        />

        {input && (
          <button
            type="button"
            onClick={() => setInput('')}
            className="mr-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-mut hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        )}

        {recognitionSupported && (
          <button
            type="button"
            onClick={handleVoiceInput}
            aria-label="Voice input"
            className={`flex h-7 w-7 items-center justify-center rounded-xl transition-all ${
              isListening
                ? 'bg-danger text-white animate-pulse'
                : 'bg-[rgba(255,255,255,0.05)] text-mut hover:bg-[var(--mint-dim)] hover:text-mint'
            }`}
          >
            {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
        )}

        {input && (
          <button
            type="submit"
            className="ml-1.5 flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint hover:bg-[var(--mint)] hover:text-white transition-colors"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </form>
  );
}
