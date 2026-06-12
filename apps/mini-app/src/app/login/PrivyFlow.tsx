'use client';

/**
 * The Privy onboarding flow — create/import wallet + optional bot-trading
 * grant. Lives in its own module (loaded via next/dynamic from the login
 * page) so the heavy @privy-io/react-auth bundle is fetched only when the
 * flow actually renders — never on first paint (W-20 perf budget).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Zap,
  KeyRound,
  Check,
  PartyPopper,
  Plus,
  Download,
  Bot,
} from 'lucide-react';
import {
  usePrivy,
  useLogin,
  useLoginWithTelegram,
  useLinkAccount,
  useLogout,
  useCreateWallet,
  useImportWallet,
  useSessionSigners,
  useWallets,
} from '@privy-io/react-auth';
import { canSendData, getInitData, getWebApp, haptic } from '@/lib/telegram';
import { apiAvailable, onboard, OnboardResult } from '@/lib/api';
import { PRIVY_SIGNER_ID } from '@/lib/privyConfig';
import PrivyClientProvider from '@/components/PrivyClientProvider';
import { AddressChip, Button, Card, FullScreenSpinner } from '@/components/ui';

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
  const { logout } = useLogout();
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

  /**
   * The bot resolves "which wallet belongs to this chat user" by looking up
   * the Privy user via their TELEGRAM id (server-side, unforgeable). A wallet
   * created on a Privy session that is NOT telegram-linked (e.g. a stale
   * email-auth session from an earlier build) is therefore invisible to the
   * bot — the exact "Almost there — your wallet isn't finished yet" loop.
   * Guard every wallet-affecting step on this.
   */
  const telegramLinked = useMemo(
    () => Boolean(user?.linkedAccounts?.some((a) => a.type === 'telegram')),
    [user]
  );

  const fail = useCallback((e: unknown, fallback: string) => {
    haptic('error');
    setError(e instanceof Error && e.message ? e.message : fallback);
    setPhase('error');
  }, []);

  /** Final step: tell the bot. Works on every launch type (see header). */
  const linkToBot = useCallback(async () => {
    // Prefer the authenticated API path: it links synchronously and lets us
    // show the rich "done" screen (address, referral, delegation state).
    if (apiAvailable()) {
      setPhase('linking');
      try {
        const r = await onboard(referral);
        haptic('success');
        setResult(r);
        setPhase('done');
        return;
      } catch {
        /* fall through to sendData — the bot can still link server-side */
      }
    }
    // Keyboard-button launches have no initData; sendData is their channel.
    if (canSendData()) {
      haptic('success');
      try {
        getWebApp()?.sendData(
          JSON.stringify({ type: 'wallet_connected', ...(referral ? { referral } : {}) })
        );
        return; // Telegram closes the app; the bot confirms in chat.
      } catch {
        /* fall through */
      }
    }
    // Wallet exists but no channel back to the bot from this launch type.
    setResult(null);
    setPhase('done');
  }, [referral]);

  /**
   * Link Telegram to an already-authenticated session (e.g. the user signed
   * in with Google via the Privy modal). Seamless when launched inside
   * Telegram: the signed initData IS the proof, no popup, no widget. Without
   * the link the bot cannot see the account (see telegramLinked above), so
   * this is required before any wallet step.
   */
  const { linkTelegram } = useLinkAccount({
    onSuccess: () => setPhase('choose'),
    onError: (err) => {
      fail(
        typeof err === 'string' ? new Error(err) : err,
        'Could not link your Telegram account — close and reopen the app, then try again.'
      );
    },
  });

  /**
   * Fallback: the standard Privy modal, showing every login method enabled
   * in the Privy dashboard (Google, external wallets, …). Used when Telegram
   * sign-in fails or the user explicitly asks for more options.
   * NOTE: Google may refuse to run inside some in-app webviews
   * ("disallowed_useragent") — that is a Google policy, not a bug here.
   */
  const { login: openPrivyModal } = useLogin({
    onComplete: ({ user: loggedIn }) => {
      const hasTelegram = loggedIn.linkedAccounts?.some((a) => a.type === 'telegram');
      if (hasTelegram) {
        setPhase('choose');
        return;
      }
      // The bot resolves users by Telegram id — link it now (seamless in TMA).
      const initDataRaw = getInitData();
      linkTelegram(initDataRaw ? { launchParams: { initDataRaw } } : undefined);
    },
    onError: (err) => {
      if (err === 'exited_auth_flow' || err === 'generic_connect_wallet_error') {
        setPhase('intro');
        return;
      }
      fail(new Error(String(err)), 'Sign-in failed — please try again.');
    },
  });

  const startAltLogin = useCallback(() => {
    setError('');
    setPhase('authenticating');
    openPrivyModal();
  }, [openPrivyModal]);

  const startLogin = useCallback(async () => {
    setError('');
    setPhase('authenticating');
    try {
      if (authenticated && !telegramLinked) {
        // Session without a Telegram link (e.g. Google sign-in): a wallet
        // made here would be invisible to the bot. Link Telegram instead of
        // throwing the session away — seamless inside Telegram.
        const initDataRaw = getInitData();
        if (initDataRaw) {
          linkTelegram({ launchParams: { initDataRaw } });
          return; // continues via the useLinkAccount callbacks
        }
        // No initData (keyboard launch / stale session) — start clean.
        await logout();
      }
      if (!authenticated || !telegramLinked) await login();
      setPhase('choose');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? '');
      if (/bot domain invalid/i.test(msg)) {
        // Telegram's login WIDGET needs the domain registered via BotFather
        // /setdomain. Seamless in-app login doesn't — so this only appears
        // when seamless auth isn't available. Offer the alternatives.
        fail(
          new Error(
            'Telegram sign-in is not fully configured (the bot has no login domain registered). ' +
              'Use “More sign-in options” below, or ask the operator to run BotFather → /setdomain.'
          ),
          ''
        );
        return;
      }
      fail(
        e,
        'Telegram sign-in failed — close and reopen the app, then try again. You can also use “More sign-in options” below.'
      );
    }
  }, [authenticated, telegramLinked, login, logout, linkTelegram, fail]);

  // Already authenticated with an existing wallet? Skip straight ahead —
  // but only for a telegram-linked session (see telegramLinked above).
  useEffect(() => {
    if (!ready) return;
    if (phase === 'choose' && telegramLinked && walletAddress) {
      setDelegated(Boolean(walletOnAccount?.delegated));
      setPhase(walletOnAccount?.delegated ? 'linking' : 'delegate');
      if (walletOnAccount?.delegated) void linkToBot();
    }
  }, [ready, phase, telegramLinked, walletAddress, walletOnAccount, linkToBot]);

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
    if (!telegramLinked) {
      fail(null, 'Session lost its Telegram link — close and reopen the app, then try again.');
      return;
    }
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
  }, [telegramLinked, createWallet, grantBotTrading, linkToBot, fail]);

  const handleImport = useCallback(async () => {
    if (!telegramLinked) {
      fail(null, 'Session lost its Telegram link — close and reopen the app, then try again.');
      return;
    }
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
  }, [telegramLinked, importKey, importWallet, grantBotTrading, linkToBot, fail]);

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

  // NOTE: no native MainButton mirror here — rendering it alongside the
  // in-page CTA showed TWO "Set up my wallet" buttons inside Telegram.
  // The in-page button is the single source of truth on every launch type.

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
          <Button variant="ghost" onClick={startAltLogin} className="mt-2">
            More sign-in options (Google, wallet…)
          </Button>
          <p className="mt-3 text-center text-[11.5px] text-mut">
            Telegram login by default · Keys secured by hardware enclaves · Exportable any time
          </p>
        </div>
      </div>
    </main>
  );
}

/** Default export: the flow wrapped in its own Privy provider. */
export default function PrivyFlow({ referral }: { referral?: string }) {
  return (
    <PrivyClientProvider>
      <PrivyLoginFlow referral={referral} />
    </PrivyClientProvider>
  );
}
