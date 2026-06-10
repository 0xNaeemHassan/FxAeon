'use client';

import { useState } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, ArrowLeft } from 'lucide-react';

function QRPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const address = searchParams.get('address') || '';
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const copyAddress = async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      await navigator?.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('Failed to copy address');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col p-4">
      {/* Error Display */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-2 text-red-600 text-sm hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <button type="button" onClick={() => { window.Telegram?.WebApp?.initData ? window.Telegram.WebApp.close() : router.back(); }} 
        className="flex items-center text-gray-600 mb-6"
      >
        <ArrowLeft className="w-5 h-5 mr-1" /> Back
      </button>

      <h1 className="text-xl font-bold mb-2">Deposit Address</h1>
      <p className="text-sm text-gray-600 mb-6">
        Send ETH, wstETH, WBTC, or fxUSD to this address
      </p>

      {address ? (
        <div className="flex flex-col items-center">
          <div className="bg-white p-4 rounded-xl border-2 border-gray-100 mb-6">
            <QRCodeSVG value={address} size={240} level="M" includeMargin={true} />
          </div>

          <div className="w-full bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Address</p>
            <div className="flex items-center justify-between">
              <p className="text-sm font-mono text-gray-900 break-all mr-3">{address}</p>
              <button
                type="button"
                onClick={copyAddress}
                disabled={isLoading}
                className="flex-shrink-0 p-2 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                aria-label="Copy address"
              >
                {copied ? (
                  <Check className="w-5 h-5 text-green-600" />
                ) : (
                  <Copy className="w-5 h-5 text-gray-600" />
                )}
              </button>
            </div>
          </div>

          <div className="w-full bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800">
              <strong>Important:</strong> Only send supported tokens. Sending unsupported tokens may result in permanent loss.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-500">Loading address...</p>
        </div>
      )}
    </div>
  );
}

export default function QRPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
      <QRPageContent />
    </Suspense>
  );
}
