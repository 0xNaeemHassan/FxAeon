'use client';
// NOTE: Consider dynamic() for heavy components in production

import { useState } from 'react';
import { useLoading } from '@/components/LoadingProvider';
import { useLoading } from '@/components/LoadingProvider';

export default function Login() {
  const { setIsLoading, setLoadingMessage } = useLoading();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'connect' | 'verify'>('connect');

  async function handleConnect() {
    setIsLoading(true);
    setLoadingMessage('Connecting wallet...');
    try {
      const tg = typeof window !== 'undefined' && (window as any).Telegram?.WebApp;
      if (tg) {
        tg.showConfirm('Connect with Privy?', (confirmed: boolean) => {
          if (confirmed) setStep('verify');
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-4 tg-mini-app flex flex-col items-center justify-center" role="main" aria-label="Login page">
      <div className="w-full max-w-sm">
        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm">{error}</p>
            <button type="button" type="button"
              onClick={() => setError(null)}
              className="mt-2 text-red-600 text-sm hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <h1 className="text-2xl font-bold text-center mb-6" tabIndex={0}>Connect Wallet</h1>
        
        {step === 'connect' && (
          <section aria-label="Wallet connection options">
            <button type="button" onClick={handleConnect}
              className="w-full bg-blue-600 text-white p-4 rounded-lg mb-3 btn-touch"
              aria-label="Connect with Privy"
            >
              Connect with Privy
            </button>
            <a
              href="/qr"
              className="block w-full bg-gray-200 dark:bg-gray-700 text-center p-4 rounded-lg btn-touch"
              aria-label="Scan QR code"
            >
              Scan QR Code
            </a>
          </section>
        )}
        
        {step === 'verify' && (
          <section aria-label="Verification step" aria-live="polite">
            <p className="text-center text-gray-600 dark:text-gray-300 mb-4">
              Check your Telegram for verification...
            </p>
            <div className="flex justify-center">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
