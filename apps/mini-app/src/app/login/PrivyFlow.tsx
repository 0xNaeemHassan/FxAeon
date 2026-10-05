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
import { ChevronRight, Lock, Mail, Plus, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useConnectWallet,
  useCreateWallet,
  useLogin,
  usePrivy,
  useWallets,
} from '@privy-io/react-auth';
import { haptic } from '@/lib/telegram';
import { AddressChip, Button, FullScreenSpinner } from '@/components/ui';
import FxLogo from '@/components/FxLogo';
import { WalletAvatar } from '@/components/WalletAvatar';
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
  const { createWallet } = useCreateWallet();
  const { connectWallet } = useConnectWallet();
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState('');
  const phaseHeadingRef = useRef<HTMLHeadingElement>(null);

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
      // Let Privy show every method enabled for the app. This keeps the
      // wallet entry usable for email and future Telegram dashboard enablement
      // without advertising a currently disabled provider-specific button.
      openPrivyLogin();
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
      <main className={`${styles.loginPanel} ${styles.authStage} mx-auto w-full`}>
        <AuthCheck />
        <h1 ref={phaseHeadingRef} tabIndex={-1} className={styles.authTitle}>
          Wallet ready
        </h1>
        {walletAddress && (
          <div className={styles.authIdentity}>
            <WalletAvatar address={walletAddress} size={28} />
            <AddressChip address={walletAddress} />
          </div>
        )}
        <p className={styles.authNote}>
          <strong>You stay in control.</strong>{' '}
          Every transaction still requires your wallet approval. FxAeon never receives your private key.
        </p>
        <div className={styles.authActions}>
          <Button onClick={() => router.push('/')}>
            Continue
          </Button>
        </div>
      </main>
    );
  }

  if (phase === 'choose' || phase === 'creating') {
    const creating = phase === 'creating';
    return (
      <main className={`${styles.loginPanel} ${styles.authStage} mx-auto w-full`}>
        <h1 ref={phaseHeadingRef} tabIndex={-1} className={styles.authTitle}>
          Choose your wallet
        </h1>
        <p className={styles.authLead}>
          Create a wallet for this account or connect one you already use. Nothing is created or connected automatically.
        </p>
        <div className={styles.authOptions}>
          <button type="button" className={styles.authOption} onClick={handleCreate} disabled={creating} aria-busy={creating || undefined}>
            <span className={styles.authOptionIcon} aria-hidden="true"><Plus /></span>
            <span className={styles.authOptionText}>
              <strong>{creating ? 'Creating wallet…' : 'Create a new wallet'}</strong>
              <small>Create a wallet secured by Privy for this account.</small>
            </span>
            {creating ? <span className={styles.authSpinner} aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
          <button type="button" className={styles.authOption} onClick={startExternalWallet}>
            <span className={styles.authOptionIcon} aria-hidden="true"><Wallet /></span>
            <span className={styles.authOptionText}>
              <strong>Connect an existing wallet</strong>
              <small>Connect MetaMask, Coinbase Wallet, WalletConnect, or another supported EVM wallet.</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        {error && <p role="alert" className={styles.authNotice}>{error}</p>}
        {/* Wallet creation has no timeout, so the ways out stay available while it runs. */}
        <button type="button" className={styles.authBack} onClick={() => setPhase('intro')}>Back</button>
      </main>
    );
  }

  const busy = phase === 'authenticating';
  return (
    <main className={`${styles.loginPanel} ${styles.authStage} mx-auto w-full`}>
      <span className={styles.authHalo} aria-hidden="true"><FxLogo size={44} /></span>
      <h1 ref={phaseHeadingRef} tabIndex={-1} className={styles.authTitle}>
        {t('loginCard.signIn')}
      </h1>
      <p className={styles.authLead}>
        Continue with a wallet or email.
      </p>
      <div className={styles.authActions}>
        <Button variant="primary" onClick={startExternalWallet} disabled={busy}>
          <Wallet aria-hidden="true" />
          {t('loginCard.wallet')}
        </Button>
        <Button variant="ghost" onClick={startEmailLogin} disabled={busy}>
          <Mail aria-hidden="true" />
          {t('loginCard.email')}
        </Button>
      </div>
      {phase === 'error' && (
        <div className={styles.authNotice}>
          <p role="alert">{error}</p>
          <button type="button" className={styles.authRetry} onClick={() => { setError(''); setPhase('intro'); }}>
            Try again
          </button>
        </div>
      )}
      <p className={styles.authFinePrint}>
        {t('loginCard.terms')}
      </p>
      <span className={styles.authBadge}>
        <Lock aria-hidden="true" />
        {t('loginCard.poweredBy')} <strong>privy</strong>
      </span>
    </main>
  );
}

/** A check drawn once when the wallet is ready; reduced motion shows it whole. */
function AuthCheck() {
  return (
    <svg className={styles.authCheck} viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r="34" />
      <path d="M23 37.5 32 46.5 50 27.5" />
    </svg>
  );
}

/** The provider is mounted by the authenticated app shell. */
export default function PrivyFlow() {
  return <PrivyLoginFlow />;
}
