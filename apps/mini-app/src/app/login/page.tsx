'use client';

import { useLogin, usePrivy } from '@privy-io/react-auth';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { haptic } from '@/lib/telegram';

function LoginPageContent() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loginAttempted, setLoginAttempted] = useState(false);
  const searchParams = useSearchParams();
  const ref = searchParams.get('ref');

  const { login } = useLogin({
    onComplete: () => {
      setError(null);
    },
    onError: (privyError: unknown) => {
      const errorStr = String(privyError);
      if (errorStr.includes('exited_auth_flow') || errorStr.includes('user_exited')) {
        setLoginAttempted(false);
        return;
      }
      setError('Login failed. Please try again.');
      setLoginAttempted(false);
      console.error('[Login] Privy error:', privyError);
    },
  });

  const handleLogin = useCallback(() => {
    setError(null);
    setLoginAttempted(true);
    login();
  }, [login]);

  // Auto-open login modal on first mount (only once)
  useEffect(() => {
    if (ready && !authenticated && !loginAttempted) {
      handleLogin();
    }
  }, [ready, authenticated, loginAttempted, handleLogin]);

  // After successful authentication, redirect or send data to Telegram
  useEffect(() => {
    if (!authenticated || !user) return;

    const wallet = user.wallet?.address;

    // If inside Telegram WebApp, send wallet data and close
    if (wallet && window.Telegram?.WebApp?.initData) {
      haptic('success');
      window.Telegram.WebApp.sendData(JSON.stringify({
        type: 'wallet_connected',
        address: wallet,
        privyUserId: user.id,
        referral: ref,
      }));
      window.Telegram.WebApp.close();
      return;
    }

    // Otherwise redirect to portfolio
    router.replace('/portfolio');
  }, [authenticated, user, ref, router]);

  if (authenticated && user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Connected!</h1>
          <p className="text-gray-600 mb-4">
            {user.wallet?.address
              ? `Wallet: ${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}`
              : `Logged in as ${user.email?.address || user.id}`}
          </p>
          <p className="text-sm text-gray-400">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold mb-2">fxBot Wallet</h1>
        <p className="text-gray-600 mb-6">
          Non-custodial · Zero key custody
        </p>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        )}

        {!ready ? (
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            <p className="text-sm text-gray-500">Initializing...</p>
          </div>
        ) : (
          <button
            onClick={handleLogin}
            className="w-full btn-touch bg-primary text-white font-semibold py-3 px-6 rounded-xl hover:opacity-90 transition-opacity"
          >
            Log In / Sign Up
          </button>
        )}

        <p className="text-xs text-gray-400 mt-6">
          Powered by Privy · Secured with embedded wallets
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
