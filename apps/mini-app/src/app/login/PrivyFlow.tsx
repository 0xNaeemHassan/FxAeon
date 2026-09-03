'use client';

/**
 * Client-only authentication and wallet setup.
 *
 * This flow intentionally has no FxAeon API calls. Privy owns identity and
 * wallet custody; the only wallet mutations available here are an explicit
 * embedded-wallet creation or a user-approved external-wallet connection.
 * There is no raw private-key field and no delegated/session signer step.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lock, Mail, Plus, Send, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useConnectWallet,
  useCreateWallet,
  useLogin,
  useLoginWithTelegram,
  usePrivy,
  useWallets,
} from '@privy-io/react-auth';
import { getInitData, haptic, isTMA } from '@/lib/telegram';
import { AddressChip, Button, Card, FullScreenSpinner } from '@/components/ui';
import FxLogo from '@/components/FxLogo';
import { usePrivyWallet } from '@/lib/wallet';
import { useT } from '@/lib/i18n';
import { userSafeError } from '@/lib/errors';
import styles from '@/components/UtilitySurfaces.module.css';

type Phase = 'intro' | 'authenticating' | 'choose' | 'creating' | 'done' | 'error';

function errorMessage(error: unknown, fallback: string): string {
  return userSafeError(error, fallback);
}

function PrivyLoginFlow() {
  const t = useT();
  const router = useRouter();
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { address: selectedAddress } = usePrivyWallet();
  const { login: loginWithTelegram } = useLoginWithTelegram();
  const { createWallet } = useCreateWallet();
  const { connectWallet } = useConnectWallet();
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState('');
  const phaseHeadingRef = useRef<HTMLHeadingElement>(null);
  const telegramContext = isTMA();

  const embeddedWallet = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === 'privy' || wallet.walletClientType === 'privy-v2'),
    [wallets]
  );
  const walletAddress = selectedAddress ?? embeddedWallet?.address ?? wallets[0]?.address;

  useEffect(() => {
    phaseHeadingRef.current?.focus({ preventScroll: true });
  }, [phase]);

  // A persisted Privy session should never force a second login. Let the user
  // choose a wallet only when the authenticated account has no wallet yet.
  useEffect(() => {
    if (!ready || !authenticated) return;
    if (phase === 'intro' || phase === 'authenticating' || (phase === 'choose' && walletAddress)) {
      setPhase(walletAddress ? 'done' : 'choose');
    }
  }, [ready, authenticated, phase, walletAddress]);

  const fail = useCallback((cause: unknown, fallback: string) => {
    haptic('error');
    setError(errorMessage(cause, fallback));
    setPhase('error');
  }, []);

  const startTelegramLogin = useCallback(async () => {
    setError('');
    if (authenticated) {
      setPhase(walletAddress ? 'done' : 'choose');
      return;
    }
    setPhase('authenticating');
    try {
      // In Telegram, Privy consumes the signed launch payload restored by the
      // provider. An empty launch payload cannot authenticate a user safely.
      if (isTMA() && !getInitData()) {
        throw new Error('Reopen FxAeon from the Telegram bot menu so the signed launch data is available.');
      }
      if (isTMA()) {
        // Privy consumes the signed Telegram launch payload at provider mount.
        // Do not open the Telegram login popup inside the Telegram WebView:
        // it cannot reliably post its result back to this document.
        return;
      }
      await loginWithTelegram();
    } catch (cause) {
      fail(cause, 'Telegram sign-in failed. Close and reopen the Mini App, then try again.');
    }
  }, [authenticated, fail, loginWithTelegram, walletAddress]);

  useEffect(() => {
    if (phase !== 'authenticating' || authenticated || !isTMA() || !getInitData()) return;
    const timer = window.setTimeout(() => {
      fail(
        new Error('Automatic Telegram sign-in did not complete.'),
        'Automatic Telegram sign-in did not complete. Reopen the app from the bot menu or use another sign-in option.'
      );
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [authenticated, fail, phase]);

  const { login: openPrivyLogin } = useLogin({
    onComplete: () => setPhase(walletAddress ? 'done' : 'choose'),
    onError: (cause) => {
      if (cause === 'exited_auth_flow' || cause === 'generic_connect_wallet_error') {
        setPhase('intro');
        return;
      }
      fail(cause, 'Sign-in was not completed.');
    },
  });

  const startEmailLogin = useCallback(() => {
    setError('');
    setPhase('authenticating');
    openPrivyLogin({ loginMethods: ['email'] });
  }, [openPrivyLogin]);

  const startExternalWallet = useCallback(() => {
    setError('');
    setPhase('authenticating');
    if (authenticated) {
      connectWallet();
    } else {
      openPrivyLogin({ loginMethods: ['wallet'] });
    }
  }, [authenticated, connectWallet, openPrivyLogin]);

  const handleCreate = useCallback(async () => {
    if (!authenticated) {
      setPhase('intro');
      setError('Sign in before creating your wallet.');
      return;
    }
    setError('');
    setPhase('creating');
    try {
      await createWallet();
      haptic('success');
      setPhase('done');
    } catch (cause) {
      fail(cause, 'Wallet creation was cancelled or failed. No transaction was submitted.');
    }
  }, [authenticated, createWallet, fail]);

  if (!ready) return <FullScreenSpinner asMain />;

  if (phase === 'done') {
    return (
        <main className={`${styles.loginPanel} mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col justify-center gap-5 px-6`}>
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-[var(--success-dim)]">
            <Check className="h-8 w-8 text-success" strokeWidth={1.8} />
          </span>
          <h1 ref={phaseHeadingRef} tabIndex={-1} className="text-display text-2xl font-semibold outline-none">
            Wallet ready
          </h1>
          {walletAddress && <AddressChip address={walletAddress} />}
          <Card className={`${styles.loginCard} w-full text-left`}>
            <p className="text-[14px] leading-relaxed text-mut">
              <span className="font-medium text-[var(--text)]">You stay in control.</span>{' '}
              Every transaction still requires your wallet approval. FxAeon never receives your private key.
            </p>
          </Card>
          <Button onClick={() => router.push('/portfolio')}>
            Continue
          </Button>
        </div>
      </main>
    );
  }

  if (phase === 'choose' || phase === 'creating') {
    return (
      <main className={`${styles.loginPanel} mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col justify-center gap-4 px-6`}>
        <div className="flex flex-col gap-4">
          <h1 ref={phaseHeadingRef} tabIndex={-1} className="text-display text-[26px] font-semibold leading-tight outline-none">
            Choose your wallet
          </h1>
          <p className="text-[14px] leading-relaxed text-mut">
            Create a wallet for this account or connect one you already use. Nothing is created or connected automatically.
          </p>
          <Card className={`${styles.loginCard} flex items-start gap-3`}>
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
              <Plus className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
            </span>
            <span className="flex-1">
              <p className="text-[14px] font-medium">Create a new wallet</p>
              <p className="mt-1 text-[13px] leading-relaxed text-mut">
                Create a wallet secured by Privy for this account.
              </p>
              <Button onClick={handleCreate} loading={phase === 'creating'} className="mt-3">
                {phase === 'creating' ? 'Creating…' : 'Create wallet'}
              </Button>
            </span>
          </Card>
          <Card className={`${styles.loginCard} flex items-start gap-3`}>
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
              <Wallet className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
            </span>
            <span className="flex-1">
              <p className="text-[14px] font-medium">Connect an existing wallet</p>
              <p className="mt-1 text-[13px] leading-relaxed text-mut">
                Connect MetaMask, Coinbase Wallet, WalletConnect, or another supported EVM wallet.
              </p>
              <Button variant="ghost" onClick={startExternalWallet} className="mt-3">
                Connect wallet
              </Button>
            </span>
          </Card>
          {error && (
            <Card className={`${styles.loginCard} border-[rgba(255,194,75,0.35)]`}>
              <p role="alert" className="text-[13px] leading-relaxed text-warn">{error}</p>
            </Card>
          )}
          <Button variant="ghost" onClick={() => setPhase('intro')}>Back</Button>
        </div>
      </main>
    );
  }

  const busy = phase === 'authenticating';
  return (
    <main className="mx-auto flex min-h-[var(--tg-viewport-stable-height)] w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="flex flex-col">
        <div className={`${styles.loginCard} glass mx-auto w-full max-w-sm p-6`}>
          <div className="flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)]">
              <FxLogo size={48} />
            </span>
            <p className="text-display mt-2.5 text-[20px] font-semibold tracking-tight">Fx<span className="text-gradient">Aeon</span></p>
          </div>
          <h1 ref={phaseHeadingRef} tabIndex={-1} className="text-display mt-5 text-center text-[23px] font-semibold leading-tight outline-none">
            {t('loginCard.signIn')}
          </h1>
          <p className="mt-2 text-center text-[14px] leading-relaxed text-mut">
            {telegramContext
              ? 'Continue with Telegram, a wallet you already use, or email.'
              : 'Continue with a wallet, email, or Telegram.'}
          </p>
          <div className={`${styles.loginActions} mt-6`}>
            {telegramContext && (
              <Button onClick={startTelegramLogin} loading={busy}>
                {!busy && <Send className="h-[18px] w-[18px]" strokeWidth={2} />}
                {t('loginCard.telegram')}
              </Button>
            )}
            {telegramContext && <p className="pt-1 text-center text-[13px] font-medium text-mut">Other ways to continue</p>}
            <Button variant={telegramContext ? 'ghost' : 'primary'} onClick={startExternalWallet} disabled={busy}>
              <Wallet className="h-[18px] w-[18px]" strokeWidth={2} />
              {t('loginCard.wallet')}
            </Button>
            <Button variant="ghost" onClick={startEmailLogin} disabled={busy}>
              <Mail className="h-[18px] w-[18px]" strokeWidth={2} />
              {t('loginCard.email')}
            </Button>
            {!telegramContext && (
              <>
                <p className="pt-1 text-center text-[13px] font-medium text-mut">Another way to continue</p>
                <Button variant="ghost" onClick={startTelegramLogin} loading={busy}>
                  {!busy && <Send className="h-[18px] w-[18px] text-mint" strokeWidth={2} />}
                  {t('loginCard.telegram')}
                </Button>
              </>
            )}
          </div>
          {phase === 'error' && (
            <Card className={`${styles.loginCard} mt-4 border-[rgba(255,194,75,0.35)]`}>
              <p role="alert" className="text-[13px] leading-relaxed text-warn">{error}</p>
              <Button variant="ghost" className="mt-2" onClick={() => { setError(''); setPhase('intro'); }}>
                Try again
              </Button>
            </Card>
          )}
          <p className="mt-5 text-center text-[13px] leading-relaxed text-mut">
            {t('loginCard.terms')}
          </p>
        </div>
        <div className="mt-5 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] text-mut">
            <Lock className="h-3 w-3 text-mint" strokeWidth={2.2} />
            {t('loginCard.poweredBy')} <span className="font-semibold text-[var(--text)]">privy</span>
          </span>
        </div>
      </div>
    </main>
  );
}

/** The provider is mounted by the authenticated app shell. */
export default function PrivyFlow() {
  return <PrivyLoginFlow />;
}
