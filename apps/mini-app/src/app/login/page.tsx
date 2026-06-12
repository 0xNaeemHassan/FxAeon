'use client';

/**
 * Onboarding — YOUR wallet, your choice, ~four taps.
 *
 *  1. Telegram seamless login with Privy (no email, no password — the signed
 *     Mini App init data IS the login).
 *  2. Create a fresh embedded wallet OR import an existing private key. The
 *     key lives in Privy's TEE; only the user can export it. The FxAeon
 *     backend never sees it and cannot create wallets for anyone.
 *  3. Optionally enable bot trading: a revocable session-signer grant that
 *     lets the bot execute f(x) actions from chat. Skipping it keeps the
 *     Mini App fully functional.
 *  4. Link to the bot, on EVERY launch type:
 *     - keyboard-button launch: initData is EMPTY but sendData() works → send
 *       the signal, the bot links the wallet server-side and replies in chat.
 *     - inline/menu/direct launch: signed initData → POST /onboard.
 *     - plain browser → "Open in Telegram".
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ShieldCheck,
  Zap,
  KeyRound,
  Send,
  Check,
  PartyPopper,
  Plus,
  Download,
  Bot,
} from 'lucide-react';
import {
  usePrivy,
  useLoginWithTelegram,
  useCreateWallet,
  useImportWallet,
  useSessionSigners,
  useWallets,
} from '@privy-io/react-auth';
import { isTMA, canSendData, getWebApp, haptic, showMainButton } from '@/lib/telegram';
import { apiAvailable, onboard, OnboardResult } from '@/lib/api';
import { privyConfigured, PRIVY_SIGNER_ID } from '@/components/PrivyClientProvider';
import { AddressChip, Button, Card, FullScreenSpinner } from '@/components/ui';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'FxAeonBot';

const VALUE_PROPS = [
  {
    icon: KeyRound,
    title: 'Your wallet, your keys',
    body: 'Create a new wallet or import your own. Keys live in a secure enclave — exportable by you, invisible to us.',
  },
  {
    icon: Zap,
    title: 'Trade from chat',
    body: 'Open leveraged wstETH and WBTC positions with a message. Confirm in one tap.',
  },
  {
    icon: ShieldCheck,
    title: 'You stay in control',
    body: 'Bot trading is a permission YOU grant — and can revoke any time. Nothing signs without it.',
  },
];

type Phase =
  | 'intro'
  | 'authenticating'
  | 'choose' // create vs import
  | 'creating'
  | 'importing' // showing the import form
  | 'importing-busy'
  | 'delegate' // wallet exists; offer bot-trading grant
  | 'delegating'
  | 'linking' // syncing with the bot backend
  | 'done'
  | 'error';

function PrivyLoginFlow({ referral }: { referral?: string }) {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLoginWithTelegram();
  const { createWallet } = useCreateWallet();
  const { importWallet } = useImportWallet();
  const { addSessionSigners } = useSessionSigners();
  const { wallets } = useWallets();

  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState('');
  const [importKey, setImportKey] = useState('');
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [delegated, setDelegated] = useState(false);

  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === 'privy'),
    [wallets]
  );
  const walletOnAccount = useMemo(() => {
    const acct = user?.linkedAccounts?.find(
      (a) =>
        a.type === 'wallet' &&
        (a as { walletClientType?: string }).walletClientType === 'privy' &&
        (a as { chainType?: string }).chainType === 'ethereum'
    ) as { address?: string; delegated?: boolean } | undefined;
    return acct;
  }, [user]);
  const walletAddress = embedded?.address ?? walletOnAccount?.address;

  const fail = useCallback((e: unknown, fallback: string) => {
    haptic('error');
    setError(e instanceof Error && e.message ? e.message : fallback);
    setPhase('error');
  }, []);

  /** Final step: tell the bot. Works on every launch type (see header). */
  const linkToBot = useCallback(async () => {
    if (canSendData()) {
      haptic('success');
      try {
        getWebApp()?.sendData(
          JSON.stringify({ type: 'wallet_connected', ...(referral ? { referral } : {}) })
        );
        return; // Telegram closes the app; the bot confirms in chat.
      } catch {
        /* fall through to API path */
      }
    }
    if (apiAvailable()) {
      setPhase('linking');
      try {
        const r = await onboard(referral);
        haptic('success');
        setResult(r);
        setPhase('done');
      } catch (e) {
        fail(e, 'Linking your wallet to the bot failed — your wallet is safe, retry in a moment.');
      }
      return;
    }
    // Wallet exists but no channel back to the bot from this launch type.
    setResult(null);
    setPhase('done');
  }, [referral, fail]);

  const startLogin = useCallback(async () => {
    setError('');
    setPhase('authenticating');
    try {
      if (!authenticated) await login();
      setPhase('choose');
    } catch (e) {
      fail(e, 'Telegram login failed — close and reopen the app, then try again.');
    }
  }, [authenticated, login, fail]);

  // Already authenticated with an existing wallet? Skip straight ahead.
  useEffect(() => {
    if (!ready) return;
    if (phase === 'choose' && walletAddress) {
      setDelegated(Boolean(walletOnAccount?.delegated));
      setPhase(walletOnAccount?.delegated ? 'linking' : 'delegate');
      if (walletOnAccount?.delegated) void linkToBot();
    }
  }, [ready, phase, walletAddress, walletOnAccount, linkToBot]);

  /**
   * Attach the bot-trading session signer right after create/import. The
   * explicit consent is the CTA label ("… & enable bot trading"). Fail-soft:
   * a failed grant routes to the dedicated delegate screen instead of
   * blocking a perfectly good wallet.
   */
  const grantBotTrading = useCallback(
    async (address: string): Promise<boolean> => {
      if (!PRIVY_SIGNER_ID) return false;
      try {
        await addSessionSigners({ address, signers: [{ signerId: PRIVY_SIGNER_ID }] });
        return true;
      } catch {
        return false;
      }
    },
    [addSessionSigners]
  );

  const handleCreate = useCallback(async () => {
    setPhase('creating');
    try {
      const wallet = await createWallet();
      const granted = await grantBotTrading(wallet.address);
      setDelegated(granted);
      haptic('success');
      if (PRIVY_SIGNER_ID && !granted) {
        setPhase('delegate'); // wallet is fine — offer the grant again or skip
        return;
      }
      await linkToBot();
    } catch (e) {
      fail(e, 'Wallet creation failed — nothing was created. Try again.');
    }
  }, [createWallet, grantBotTrading, linkToBot, fail]);

  const handleImport = useCallback(async () => {
    const key = importKey.trim();
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) {
      setError('That doesn’t look like a private key (64 hex characters).');
      return;
    }
    setPhase('importing-busy');
    try {
      const wallet = await importWallet({
        privateKey: key.startsWith('0x') ? key : `0x${key}`,
      });
      setImportKey('');
      const granted = await grantBotTrading(wallet.address);
      setDelegated(granted);
      haptic('success');
      if (PRIVY_SIGNER_ID && !granted) {
        setPhase('delegate');
        return;
      }
      await linkToBot();
    } catch (e) {
      setImportKey('');
      fail(e, 'Import failed. The key never left the secure channel — check it and try again.');
    }
  }, [importKey, importWallet, grantBotTrading, linkToBot, fail]);

  const handleDelegate = useCallback(async () => {
    if (!walletAddress || !PRIVY_SIGNER_ID) {
      void linkToBot();
      return;
    }
    setPhase('delegating');
    try {
      await addSessionSigners({
        address: walletAddress,
        signers: [{ signerId: PRIVY_SIGNER_ID }],
      });
      setDelegated(true);
      haptic('success');
      await linkToBot();
    } catch (e) {
      fail(e, 'Granting bot trading failed — you can also enable it later in Settings.');
    }
  }, [walletAddress, addSessionSigners, linkToBot, fail]);

  // Native MainButton mirrors the primary CTA inside Telegram.
  useEffect(() => {
    if (!isTMA()) return;
    if (phase === 'intro') return showMainButton('Set up my wallet', startLogin);
    if (phase === 'done') return showMainButton('Done — back to chat', () => getWebApp()?.close());
  }, [phase, startLogin]);

  if (!ready) return <FullScreenSpinner />;

  // ── Done ──────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <main className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col justify-center gap-5 px-6">
        <div className="stagger flex flex-col items-center gap-4 text-center">
          <span className="anim-glow flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--mint-dim)]">
            {result?.created ?? true ? (
              <PartyPopper className="h-8 w-8 text-mint" strokeWidth={1.6} />
            ) : (
              <Check className="h-8 w-8 text-mint" strokeWidth={2} />
            )}
          </span>
          <h1 className="text-display text-2xl font-semibold">
            {result ? (result.created ? 'Wallet ready — and it’s yours' : 'You’re already set up') : 'Wallet ready'}
          </h1>
          {(result?.walletAddress ?? walletAddress) && (
            <AddressChip address={(result?.walletAddress ?? walletAddress)!} />
          )}
          {result?.referralApplied && (
            <p className="text-[12.5px] text-mut">🎁 Referral applied: {result.referralApplied}</p>
          )}
          <Card className="w-full text-left">
            <p className="text-[13px] leading-relaxed text-mut">
              <span className="font-medium text-[var(--text)]">
                {delegated ? 'Bot trading is ON.' : 'Bot trading is OFF.'}
              </span>{' '}
              {delegated
                ? 'You can trade from chat — revoke any time in Settings → Wallet.'
                : 'Enable it in Settings → Wallet whenever you want chat trading.'}{' '}
              Next: fund the address (ETH, wstETH or WBTC), then open a trade.
            </p>
          </Card>
          <Button onClick={() => getWebApp()?.close()}>Done — back to chat</Button>
        </div>
      </main>
    );
  }

  // ── Choose: create vs import ─────────────────────────────────────────────
  if (phase === 'choose' || phase === 'creating') {
    return (
      <main className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col justify-center gap-4 px-6">
        <div className="stagger flex flex-col gap-4">
          <h1 className="text-display text-[26px] font-semibold leading-tight">
            Your wallet, <span className="text-gradient">your call</span>
          </h1>
          <p className="text-[13.5px] leading-relaxed text-mut">
            Either way the key sits in a hardware enclave, exportable only by you.
            {PRIVY_SIGNER_ID
              ? ' Bot trading (revocable) is enabled in the same step so you can trade from chat immediately.'
              : ''}
          </p>
          <Card className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
              <Plus className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
            </span>
            <span className="flex-1">
              <p className="text-[14px] font-medium">Create a new wallet</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">
                Fresh address, ready in seconds. No seed phrase to lose.
              </p>
              <Button
                onClick={handleCreate}
                loading={phase === 'creating'}
                className="mt-3"
              >
                {phase === 'creating' ? 'Creating…' : PRIVY_SIGNER_ID ? 'Create & enable bot trading' : 'Create wallet'}
              </Button>
            </span>
          </Card>
          <Card className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
              <Download className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
            </span>
            <span className="flex-1">
              <p className="text-[14px] font-medium">Import an existing wallet</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">
                Bring your own key. It goes straight into the enclave over an encrypted
                channel — FxAeon never sees it.
              </p>
              <Button variant="ghost" onClick={() => setPhase('importing')} className="mt-3">
                Import private key
              </Button>
            </span>
          </Card>
          {error && (
            <Card className="border-[rgba(255,194,75,0.35)]">
              <p className="text-[13px] leading-relaxed text-warn">{error}</p>
            </Card>
          )}
        </div>
      </main>
    );
  }

  // ── Import form ──────────────────────────────────────────────────────────
  if (phase === 'importing' || phase === 'importing-busy') {
    return (
      <main className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col justify-center gap-4 px-6">
        <div className="stagger flex flex-col gap-4">
          <h1 className="text-display text-[26px] font-semibold leading-tight">Import your wallet</h1>
          <p className="text-[13.5px] leading-relaxed text-mut">
            Paste the private key (64 hex characters). It is sent over an encrypted channel
            directly into Privy’s secure enclave — it never touches FxAeon’s servers and is
            not stored in this app.
          </p>
          <textarea
            value={importKey}
            onChange={(e) => setImportKey(e.target.value)}
            placeholder="0x…"
            rows={3}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 font-mono text-[13px] text-[var(--text)] outline-none focus:border-[var(--mint)]"
          />
          {error && (
            <Card className="border-[rgba(255,194,75,0.35)]">
              <p className="text-[13px] leading-relaxed text-warn">{error}</p>
            </Card>
          )}
          <Button onClick={handleImport} loading={phase === 'importing-busy'}>
            {phase === 'importing-busy' ? 'Importing…' : PRIVY_SIGNER_ID ? 'Import & enable bot trading' : 'Import wallet'}
          </Button>
          <Button variant="ghost" onClick={() => { setImportKey(''); setError(''); setPhase('choose'); }}>
            Back
          </Button>
        </div>
      </main>
    );
  }

  // ── Delegate (existing wallet without grant) ─────────────────────────────
  if (phase === 'delegate' || phase === 'delegating') {
    return (
      <main className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col justify-center gap-4 px-6">
        <div className="stagger flex flex-col gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--mint-dim)]">
            <Bot className="h-7 w-7 text-mint" strokeWidth={1.8} />
          </span>
          <h1 className="text-display text-[26px] font-semibold leading-tight">Enable bot trading?</h1>
          <p className="text-[13.5px] leading-relaxed text-mut">
            This grants the bot a <span className="text-[var(--text)]">revocable</span> permission
            (a session signer) to execute the f(x) trades you confirm in chat. Your key never
            moves; you can revoke the grant any time in Settings → Wallet. Skip it and the Mini
            App still works fully.
          </p>
          {walletAddress && <AddressChip address={walletAddress} />}
          {error && (
            <Card className="border-[rgba(255,194,75,0.35)]">
              <p className="text-[13px] leading-relaxed text-warn">{error}</p>
            </Card>
          )}
          <Button onClick={handleDelegate} loading={phase === 'delegating'}>
            {phase === 'delegating' ? 'Enabling…' : 'Enable bot trading'}
          </Button>
          <Button variant="ghost" onClick={() => void linkToBot()}>
            Skip for now
          </Button>
        </div>
      </main>
    );
  }

  // ── Intro ─────────────────────────────────────────────────────────────────
  return (
    <main className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col px-6 pb-8 pt-10">
      <div className="stagger flex flex-1 flex-col">
        <h1 className="text-display text-[34px] font-semibold leading-tight">
          Trade f(x) like it’s <span className="text-gradient">a message</span>
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-mut">
          Create or import your own wallet — self-custody, no email, no compromise.
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
          <Button onClick={startLogin} loading={phase === 'authenticating'} className="anim-glow">
            {phase === 'authenticating' ? 'Connecting…' : 'Set up my wallet'}
          </Button>
          <p className="mt-3 text-center text-[11.5px] text-mut">
            Telegram login · Keys secured by hardware enclaves · Exportable any time
          </p>
        </div>
      </div>
    </main>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);

  const referral = useMemo(() => {
    const fromUrl = searchParams.get('ref');
    if (fromUrl && /^[A-Za-z0-9]{4,16}$/.test(fromUrl)) return fromUrl.toUpperCase();
    return undefined;
  }, [searchParams]);

  useEffect(() => setMounted(true), []);

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

  if (!privyConfigured()) {
    return (
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <h1 className="text-display text-2xl font-semibold">Wallet service not configured</h1>
        <p className="text-[13.5px] text-mut">
          This build is missing its Privy app id, so wallet setup can’t run. If you’re the
          operator: set NEXT_PUBLIC_PRIVY_APP_ID (and NEXT_PUBLIC_PRIVY_SIGNER_ID for bot
          trading) and redeploy.
        </p>
      </main>
    );
  }

  return <PrivyLoginFlow referral={referral} />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <LoginContent />
    </Suspense>
  );
}
