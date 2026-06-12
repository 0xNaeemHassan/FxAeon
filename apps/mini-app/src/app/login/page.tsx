'use client';

/**
 * Onboarding — one tap, no email, no external login.
 *
 * The bot creates a policy-guarded wallet server-side; this screen's only job
 * is to trigger it and confirm it, on EVERY launch type:
 *
 *  - keyboard-button launch (from /start): initData is EMPTY and sendData()
 *    works → send the signal, Telegram closes the app, the bot replies in
 *    chat. (The old code gated sendData on initData being present — exactly
 *    inverted — so the signal NEVER fired and the bot never updated.)
 *  - inline/menu/direct launch: signed initData → call POST /onboard on the
 *    bot API → show the created wallet here AND the bot confirms in chat.
 *  - plain browser → "Open in Telegram".
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck, Zap, KeyRound, Send, Check, PartyPopper } from 'lucide-react';
import {
  isTMA,
  canSendData,
  getInitData,
  getWebApp,
  haptic,
  showMainButton,
} from '@/lib/telegram';
import { apiAvailable, onboard, OnboardResult } from '@/lib/api';
import { AddressChip, Button, Card, FullScreenSpinner } from '@/components/ui';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

const VALUE_PROPS = [
  {
    icon: ShieldCheck,
    title: 'Default-deny policy wallet',
    body: 'Your wallet can only touch verified f(x) Protocol contracts. Nothing else, ever.',
  },
  {
    icon: Zap,
    title: 'Trade from chat',
    body: 'Open leveraged wstETH and WBTC positions with a message. Confirm in one tap.',
  },
  {
    icon: KeyRound,
    title: 'Non-custodial',
    body: 'Keys live in secure enclaves — FxAeon never holds your funds.',
  },
];

type Phase = 'intro' | 'creating' | 'done' | 'error';

function LoginContent() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>('intro');
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [error, setError] = useState('');

  const referral = useMemo(() => {
    const fromUrl = searchParams.get('ref');
    if (fromUrl && /^[A-Za-z0-9]{4,16}$/.test(fromUrl)) return fromUrl.toUpperCase();
    return undefined;
  }, [searchParams]);

  useEffect(() => setMounted(true), []);

  // Native MainButton mirrors the CTA inside Telegram.
  useEffect(() => {
    if (!mounted || !isTMA() || phase !== 'intro') return;
    return showMainButton('Create my wallet', handleCreate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, phase]);

  useEffect(() => {
    if (phase !== 'done') return;
    return showMainButton('Done — back to chat', () => getWebApp()?.close());
  }, [phase]);

  function handleCreate() {
    if (canSendData()) {
      // Keyboard launch: hand off to the bot. Telegram closes the app after
      // sendData and the bot replies in chat with the created wallet.
      haptic('success');
      try {
        getWebApp()?.sendData(
          JSON.stringify({ type: 'wallet_connected', ...(referral ? { referral } : {}) })
        );
        return;
      } catch {
        /* fall through to API path */
      }
    }
    if (apiAvailable()) {
      setPhase('creating');
      onboard(referral)
        .then((r) => {
          haptic('success');
          setResult(r);
          setPhase('done');
        })
        .catch((e: Error) => {
          haptic('error');
          setError(e.message || 'Wallet creation failed — nothing was created.');
          setPhase('error');
        });
      return;
    }
    // Inside Telegram but neither channel available (API URL not configured
    // for this build): be honest and route back to the chat flow.
    haptic('warning');
    setError(
      'This launch type can’t finish setup here. Go back to the chat and tap the “Create Wallet” button under the message box, or send /start.'
    );
    setPhase('error');
  }

  if (!mounted) return <FullScreenSpinner />;

  if (!isTMA()) {
    return (
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <span className="anim-float flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--mint-dim)]">
          <Send className="h-8 w-8 text-mint" strokeWidth={1.6} />
        </span>
        <h1 className="text-display text-2xl font-semibold">FxAeon runs inside Telegram</h1>
        <p className="text-[13.5px] text-mut">Open the bot and send /start to set up your wallet.</p>
        <a href={`https://t.me/${BOT_USERNAME}`} className="w-full">
          <Button>Open @{BOT_USERNAME}</Button>
        </a>
      </main>
    );
  }

  if (phase === 'done' && result) {
    return (
      <main className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col justify-center gap-5 px-6">
        <div className="stagger flex flex-col items-center gap-4 text-center">
          <span className="anim-glow flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--mint-dim)]">
            {result.created ? (
              <PartyPopper className="h-8 w-8 text-mint" strokeWidth={1.6} />
            ) : (
              <Check className="h-8 w-8 text-mint" strokeWidth={2} />
            )}
          </span>
          <h1 className="text-display text-2xl font-semibold">
            {result.created ? 'Wallet created' : 'You’re already set up'}
          </h1>
          <AddressChip address={result.walletAddress} />
          {result.referralApplied && (
            <p className="text-[12.5px] text-mut">🎁 Referral applied: {result.referralApplied}</p>
          )}
          <Card className="w-full text-left">
            <p className="text-[13px] leading-relaxed text-mut">
              <span className="font-medium text-[var(--text)]">Next:</span> fund this address
              (ETH, wstETH or WBTC), then open a trade. The bot has also posted your wallet in
              the chat.
            </p>
          </Card>
          <Button onClick={() => getWebApp()?.close()}>Done — back to chat</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col px-6 pb-8 pt-10">
      <div className="stagger flex flex-1 flex-col">
        <h1 className="text-display text-[34px] font-semibold leading-tight">
          Trade f(x) like it’s <span className="text-gradient">a message</span>
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-mut">
          One tap creates your policy-guarded wallet. No email. No seed phrase to lose.
        </p>

        <div className="mt-7 flex flex-col gap-3">
          {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
                <Icon className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
              </span>
              <span>
                <p className="text-[14px] font-medium">{title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">{body}</p>
              </span>
            </Card>
          ))}
        </div>

        {referral && (
          <p className="mt-4 text-center text-[12.5px] text-mut">
            🎁 Referral <span className="font-mono text-mint">{referral}</span> will be applied
          </p>
        )}

        {phase === 'error' && (
          <Card className="mt-4 border-[rgba(255,194,75,0.35)]">
            <p className="text-[13px] leading-relaxed text-warn">{error}</p>
          </Card>
        )}

        <div className="mt-auto pt-7">
          <Button onClick={handleCreate} loading={phase === 'creating'} className="anim-glow">
            {phase === 'creating' ? 'Creating your wallet…' : 'Create my wallet'}
          </Button>
          <p className="mt-3 text-center text-[11.5px] text-mut">
            Takes ~3 seconds · Secured by hardware enclaves
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <LoginContent />
    </Suspense>
  );
}
