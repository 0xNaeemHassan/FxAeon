'use client';
// NOTE: Consider dynamic() for heavy components in production

import { useState } from 'react';
import { useLoading } from '@/components/LoadingProvider';
import { useLoading } from '@/components/LoadingProvider';

export default function Trade() {
  const { setIsLoading, setLoadingMessage } = useLoading();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [side, setSide] = useState<'long' | 'short'>('long');

  async function executeTrade() {
    setIsLoading(true);
    setLoadingMessage('Executing trade...');
    try {
      // Trade execution logic
      await new Promise(r => setTimeout(r, 2000));
      alert('Trade executed!');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-4 tg-mini-app" role="main" aria-label="Trade page">
      <h1 className="text-2xl font-bold mb-4" tabIndex={0} id="page-title" aria-labelledby="page-title">Trade</h1>
      
      <section aria-label="Trade form" className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <div className="flex mb-4" role="tablist" aria-label="Trade side">
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

          <button type="button" onClick={() => setSide('long')}
            className={`flex-1 p-3 rounded-l-lg btn-touch ${side === 'long' ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
            role="tab"
            aria-selected={side === 'long'}
            aria-label="Long position"
          >
            Long
          </button>
          <button type="button" onClick={() => setSide('short')}
            className={`flex-1 p-3 rounded-r-lg btn-touch ${side === 'short' ? 'bg-red-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
            role="tab"
            aria-selected={side === 'short'}
            aria-label="Short position"
          >
            Short
          </button>
        </div>

        <label className="block mb-2" htmlFor="amount">
          Amount (ETH)
        </label>
        <input
          id="amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full p-3 border rounded-lg mb-4 dark:bg-gray-700 dark:border-gray-600"
          content="0.00"
          aria-required="true"
        />

        <button type="button" onClick={executeTrade}
          disabled={!amount}
          className="w-full bg-blue-600 text-white p-4 rounded-lg btn-touch disabled:opacity-50"
          aria-label={`Execute ${side} trade`}
        >
          Execute {side === 'long' ? 'Long' : 'Short'}
        </button>
      </section>

      <a href="/" className="mt-4 inline-block text-blue-600 underline btn-touch p-2" aria-label="Back to dashboard">
        Back
      </a>
    </main>
  );
}
