'use client';

/**
 * The Privy onboarding flow — create/import wallet + optional bot-trading
 * grant. Lives in its own module (loaded via next/dynamic from the login
 * page) so the heavy @privy-io/react-auth bundle is fetched only when the
 * flow actually renders — never on first paint (W-20 perf budget).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  PartyPopper,
  Plus,
  Download,
  Bot,
  Send,
  Mail,
  Wallet,
  Lock,
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
import { canSendData, getInitData, getWebApp, haptic, isTMA } from '@/lib/telegram';
import { apiAvailable, onboard, OnboardResult } from '@/lib/api';
import { PRIVY_SIGNER_ID } from '@/lib/privyConfig';
import PrivyClientProvider from '@/components/PrivyClientProvider';
import { AddressChip, Button, Card, FullScreenSpinner } from '@/components/ui';
import FxLogo from '@/components/FxLogo';
import { useT } from '@/lib/i18n';

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
  const t = useT();
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
  const [convergenceStuck, setConvergenceStuck] = useState(false);

  // ── Convergence guard (Phase 1 §1.8) ─────────────────────────────────
  // If any non-terminal phase (authenticating, creating, importing-busy,
  // delegating, linking) lingers longer than 30s, show a Restart button.
  const CONVERGENCE_TIMEOUT_MS = 30_000;
  const busyPhases: Phase[] = [
    'authenticating',
    'creating',
    'importing-busy',
    'delegating',
    'linking',
  ];
  useEffect(() => {
    if (!busyPhases.includes(phase)) {
      setConvergenceStuck(false);
      return;
    }
    const timer = setTimeout(() => setConvergenceStuck(true), CONVERGENCE_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

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
      if (initDataRaw) {
        linkTelegram({ launchParams: { initDataRaw } });
        return;
      }
      if (isTMA()) {
        // Keyboard-button launches carry no signed initData, and the only
        // alternative (the Telegram login WIDGET popup) cannot deliver its
        // result inside Telegram's webview — be honest instead of dead-ending.
        fail(
          null,
          'Signed in! One more step: this launch type can\u2019t verify your Telegram identity. ' +
            'Close the app and reopen it from the bot\u2019s menu button — your account links automatically.'
        );
        return;
      }
      linkTelegram(); // plain browser: the widget popup works there
    },
    onError: (err) => {
      if (err === 'exited_auth_flow' || err === 'generic_connect_wallet_error') {
        setPhase('intro');
        return;
      }
      fail(new Error(String(err)), 'Sign-in failed — please try again.');
    },
  });

  // "Continue with Email": open the Privy modal scoped to the email method.
  // Telegram is still linked afterwards (in openPrivyModal's onComplete) so the
  // bot can resolve this account — see telegramLinked above.
  const startEmailLogin = useCallback(() => {
    setError('');
    setPhase('authenticating');
    openPrivyModal({ loginMethods: ['email'] });
  }, [openPrivyModal]);

  // "Connect existing wallet": open the Privy modal scoped to external wallets.
  const startWalletLogin = useCallback(() => {
    setError('');
    setPhase('authenticating');
    openPrivyModal({ loginMethods: ['wallet'] });
  }, [openPrivyModal]);

  const startLogin = useCallback(async () => {
    setError('');
    if (ready && authenticated && telegramLinked) {
      // Seamless auto-login already completed at provider mount — go on.
      setPhase('choose');
      return;
    }
    setPhase('authenticating');
    try {
      const initDataRaw = getInitData();
      if (authenticated && !telegramLinked) {
        // Session without a Telegram link (e.g. Google sign-in): a wallet
        // made here would be invisible to the bot. Link Telegram instead of
        // throwing the session away — seamless inside Telegram.
        if (initDataRaw) {
          linkTelegram({ launchParams: { initDataRaw } });
          return; // continues via the useLinkAccount callbacks
        }
        if (isTMA()) {
          // No signed initData (keyboard launch) and the widget popup is a
          // dead end inside Telegram's webview — say so instead of failing.
          fail(
            null,
            'This launch type can\u2019t verify your Telegram identity. Close the app and ' +
              'reopen it from the bot\u2019s menu button — sign-in is automatic there.'
          );
          return;
        }
        // Plain browser with a stale non-Telegram session — start clean.
        await logout();
      }
      if (isTMA()) {
        if (!initDataRaw) {
          fail(
            null,
            'This launch type can\u2019t sign in securely (no signed launch data). Close the ' +
              'app and reopen it from the bot\u2019s menu button — sign-in is automatic there.'
          );
          return;
        }
        // Inside Telegram, sign-in is AUTOMATIC: the Privy SDK consumes the
        // launch hash (restored by PrivyClientProvider) and authenticates
        // with no popup. NEVER call the login widget here — its popup cannot
        // post results back inside Telegram's webview (the
        // \u201cTelegram auth failed or was canceled by the client\u201d bug). The
        // effects below advance the flow when `authenticated` flips, and a
        // watchdog surfaces an honest error if it never does.
        return;
      }
      // Plain browser: the Telegram login widget popup works normally there.
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
  }, [ready, authenticated, telegramLinked, login, logout, linkTelegram, fail]);

  // Seamless auto-login lands here: the SDK authenticates in the background
  // (no popup) and `authenticated` flips while we sit in 'authenticating'.
  useEffect(() => {
    if (!ready || phase !== 'authenticating') return;
    if (authenticated && telegramLinked) {
      haptic('success');
      setPhase('choose');
    }
  }, [ready, phase, authenticated, telegramLinked]);

  // Watchdog: inside Telegram sign-in is automatic — if it hasn't completed
  // after a generous wait, it's a configuration problem (e.g. seamless
  // Telegram login disabled in the Privy dashboard). Be honest about it.
  useEffect(() => {
    if (phase !== 'authenticating' || authenticated) return;
    if (!isTMA() || !getInitData()) return;
    const t = setTimeout(() => {
      fail(
        null,
        'Automatic Telegram sign-in didn\u2019t complete. Try \u201cMore sign-in options\u201d below — ' +
          'and if this keeps happening, the operator should check that seamless Telegram login ' +
          'is enabled in the Privy dashboard.'
      );
    }, 15_000);
    return () => clearTimeout(t);
  }, [phase, authenticated, fail]);

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
          <span className="anim-glow flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--success-dim)]">
            {result?.created ?? true ? (
              <PartyPopper className="h-8 w-8 text-success" strokeWidth={1.6} />
            ) : (
              <Check className="h-8 w-8 text-success" strokeWidth={2} />
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

  // ── Intro: the "Sign in to FxAeon" card ─────────────────────────────────
  const authBusy = phase === 'authenticating';
  return (
    <main className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="stagger flex flex-col">
        <div
          className="glass anim-scale-in mx-auto w-full max-w-sm rounded-[28px] p-7"
          style={{ borderColor: 'rgba(124,92,255,0.30)' }}
        >
          {/* Brand mark + wordmark */}
          <div className="flex flex-col items-center text-center">
            <FxLogo size={54} className="anim-float" />
            <p className="text-display mt-2.5 text-[20px] font-semibold tracking-tight">
              Fx<span className="text-gradient">Aeon</span>
            </p>
          </div>

          {/* Heading */}
          <h1 className="text-display mt-5 text-center text-[23px] font-semibold leading-tight">
            {t('loginCard.signIn')}
          </h1>
          <p className="mt-1.5 text-center text-[13px] leading-relaxed text-mut">
            {t('loginCard.subtitle')}
          </p>

          {/* Sign-in methods */}
          <div className="mt-6 flex flex-col gap-2.5">
            <Button onClick={startLogin} loading={authBusy} className="anim-glow">
              {!authBusy && <Send className="h-[18px] w-[18px]" strokeWidth={2} />}
              {t('loginCard.telegram')}
            </Button>
            <Button variant="ghost" onClick={startEmailLogin} disabled={authBusy}>
              <Mail className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
              {t('loginCard.email')}
            </Button>
            <Button variant="ghost" onClick={startWalletLogin} disabled={authBusy}>
              <Wallet className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
              {t('loginCard.wallet')}
            </Button>
          </div>

          {referral && (
            <p className="mt-4 text-center text-[12px] text-mut">
              {t('intro.referralPre')} <span className="font-mono text-mint">{referral}</span>{' '}
              {t('intro.referralPost')}
            </p>
          )}

          {phase === 'error' && (
            <Card className="mt-4 border-[rgba(255,194,75,0.35)]">
              <p className="text-[13px] leading-relaxed text-warn">{error}</p>
            </Card>
          )}

          {/* Convergence guard: restart button when a busy phase hangs */}
          {convergenceStuck && (
            <Card className="mt-4 border-[rgba(255,194,75,0.35)]">
              <p className="text-[13px] leading-relaxed text-warn">
                This step is taking longer than expected.
              </p>
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => {
                  setError('');
                  setConvergenceStuck(false);
                  setPhase('intro');
                  haptic('error');
                }}
              >
                ↻ Restart
              </Button>
            </Card>
          )}

          {/* Terms */}
          <p className="mt-5 text-center text-[11px] leading-relaxed text-mut">
            {t('loginCard.terms')}
          </p>
        </div>

        {/* Powered by Privy */}
        <div className="mt-5 flex justify-center">
          <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-mut">
            <Lock className="h-3 w-3 text-mint" strokeWidth={2.2} />
            {t('loginCard.poweredBy')}{' '}
            <span className="font-semibold text-[var(--text)]">privy</span>
          </span>
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
