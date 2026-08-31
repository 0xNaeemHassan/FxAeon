'use client';

/** Client-only Privy login and explicit wallet setup. */
import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowRight, Globe2, ShieldCheck, Wallet } from 'lucide-react';
import { privyConfigured } from '@/lib/privyConfig';
import { Button, Card, FullScreenSpinner } from '@/components/ui';
import { usePrivyWallet } from '@/lib/wallet';
import { userSafeError } from '@/lib/errors';
import { haptic } from '@/lib/telegram';
import FxLogo from '@/components/FxLogo';

// The Privy SDK is heavy. Loading the flow dynamically keeps it
// out of this page's first-paint bundle — the chunk is only fetched once the
// configuration gate below passes. The same flow supports web and Telegram.
const PrivyFlow = dynamic(() => import('./PrivyFlow'), {
  ssr: false,
  loading: () => <FullScreenSpinner asMain />,
});

function LoginContent() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · FxAeon';
    setMounted(true);
  }, []);

  if (!mounted) return <FullScreenSpinner asMain />;

  if (!privyConfigured()) {
    return <BrowserWalletFlow />;
  }

  return <PrivyFlow />;
}

function BrowserWalletFlow() {
  const wallet = usePrivyWallet();
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setError('');
    setConnecting(true);
    try {
      await wallet.connect();
      haptic('success');
    } catch (cause) {
      setError(userSafeError(cause, 'Browser wallet connection was cancelled.'));
      haptic('error');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-context" aria-label="FxAeon wallet security">
        <Link href="/" className="auth-brand"><FxLogo size={32} /><span><strong>FxAeon</strong><small>Ethereum interface</small></span></Link>
        <div className="auth-context-copy">
          <p className="landing-kicker"><span>02</span> Wallet access</p>
          <h2>Connect once.<br /><span className="text-gradient">Stay in control.</span></h2>
          <p>Your wallet is the signer. FxAeon prepares and validates each route without holding your keys.</p>
        </div>
        <div className="auth-assurance"><ShieldCheck className="h-4 w-4 text-mint" aria-hidden="true" /> Your wallet stays the signer</div>
      </section>
      <section className="auth-panel">
        <div className="auth-mode"><Globe2 className="h-4 w-4 text-mint" aria-hidden="true" /> Browser wallet</div>
        <Card className="w-full p-6">
          <span className="auth-wallet-icon"><Wallet className="h-6 w-6 text-mint" strokeWidth={1.8} aria-hidden="true" /></span>
          <h1 className="text-display mt-5 text-[28px] font-semibold">Connect your wallet</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-mut">Use MetaMask, Coinbase Wallet, or another EVM wallet. Every transaction is confirmed in your wallet.</p>

          {wallet.authenticated && wallet.address ? (
            <div className="mt-5">
              <div className="auth-address">{wallet.address}</div>
              <Link href="/portfolio" onClick={() => haptic('medium')} className="button button-primary glass-press mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-[14px] font-semibold">Continue to FxAeon <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </div>
          ) : (
            <>
              <Button onClick={connect} loading={connecting} className="mt-5 w-full">Connect browser wallet</Button>
              {error && <p role="alert" className="mt-3 rounded-lg border border-[var(--danger-dim)] bg-[var(--danger-dim)] px-3 py-2.5 text-[12px] leading-relaxed text-danger">{error}</p>}
            </>
          )}
        </Card>
        <p className="mt-4 text-[11px] leading-relaxed text-mut">Telegram sign-in and embedded wallets become available when the optional wallet service is configured.</p>
        <Link href="/" className="mt-4 inline-flex min-h-11 items-center text-[12px] font-semibold text-mint">← Back to home</Link>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<FullScreenSpinner asMain />}>
      <LoginContent />
    </Suspense>
  );
}
