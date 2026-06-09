'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Suspense } from 'react';

function LoginPageContent() {
  const { login, ready, authenticated, user } = usePrivy();
  const searchParams = useSearchParams();
  const ref = searchParams.get('ref');

  useEffect(() => {
    if (ready && !authenticated) {
      login();
    }
  }, [ready, authenticated, login]);

  useEffect(() => {
    if (authenticated && user) {
      const wallet = user.wallet?.address;
      if (wallet && window.Telegram?.WebApp) {
        window.Telegram.WebApp.sendData(JSON.stringify({
          type: 'wallet_connected',
          address: wallet,
          privyUserId: user.id,
          referral: ref,
        }));
        window.Telegram.WebApp.close();
      }
    }
  }, [authenticated, user, ref]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">fxBot Wallet Connection</h1>
        <p className="text-gray-600 mb-6">
          Connecting via Privy...<br />
          Non-custodial · Zero key custody
        </p>
        {!ready && (
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
      <LoginPageContent />
    </Suspense>
  );
}
