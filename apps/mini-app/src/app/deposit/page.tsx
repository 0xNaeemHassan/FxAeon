'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, ArrowLeft, Wallet } from 'lucide-react';
import Link from 'next/link';

export default function DepositPage() {
  const { user, ready } = usePrivy();
  const [copied, setCopied] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const walletAddress = user?.wallet?.address;

  const handleCopy = async () => {
    if (!walletAddress) return;
    try {
      await navigator?.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('Failed to copy address');
    }
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <Wallet className="w-16 h-16 text-gray-400 mb-4" />
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Connect Your Wallet</h1>
        <p className="text-gray-600 text-center mb-6">Please connect your wallet to view your deposit address.</p>
        <Link href="/login" className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          Connect Wallet
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center mb-6">
          <Link href="/" className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </Link>
          <h1 className="text-xl font-bold text-gray-900 ml-3">Deposit</h1>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm">{error}</p>
            <button type="button"
              onClick={() => setError(null)}
              className="mt-2 text-red-600 text-sm hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Deposit Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="text-center mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Your Deposit Address</h2>
            <p className="text-sm text-gray-500">Send ETH or ERC-20 tokens to this address</p>
          </div>

          {walletAddress ? (
            <>
              {/* QR Code */}
              <div className="flex justify-center mb-6">
                <div className="p-4 bg-white border-2 border-gray-100 rounded-xl">
                  <QRCodeSVG
                    value={walletAddress}
                    size={200}
                    level="M"
                    includeMargin={true}
                  />
                </div>
              </div>

              {/* Address Display */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Ethereum Address</p>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-mono text-gray-900 break-all mr-3">
                    {walletAddress}
                  </p>
                  <button type="button"
                    onClick={handleCopy}
                    className="flex-shrink-0 p-2 hover:bg-gray-200 rounded-lg transition-colors"
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

              {/* Warning */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800">
                  <strong>Important:</strong> Only send ETH and supported ERC-20 tokens to this address.
                  Sending unsupported tokens may result in permanent loss.
                </p>
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">No wallet address available</p>
              <button type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Refresh
              </button>
            </div>
          )}
        </div>

        {/* Network Info */}
        <div className="mt-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Network</span>
            <span className="text-sm font-medium text-gray-900">Ethereum Mainnet</span>
          </div>
        </div>
      </div>
    </div>
  );
}
