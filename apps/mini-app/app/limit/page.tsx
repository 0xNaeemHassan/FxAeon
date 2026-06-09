'use client';
// NOTE: Consider dynamic() for heavy components in production

import { useState } from 'react';
import { useLoading } from '@/components/LoadingProvider';
import { useLoading } from '@/components/LoadingProvider';

export default function Limit() {
  const { setIsLoading } = useLoading();
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');

  async function placeOrder() {
    setIsLoading(true);
    try {
      await new Promise(r => setTimeout(r, 1500));
      alert('Limit order placed!');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-4 tg-mini-app" role="main" aria-label="Limit orders page">
      <h1 className="text-2xl font-bold mb-4" tabIndex={0} id="page-title" aria-labelledby="page-title">Limit Orders</h1>
      
      <section aria-label="Limit order form" className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <label className="block mb-2" htmlFor="limit-price">Trigger Price (USD)</label>
        <input
          id="limit-price"
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-full p-3 border rounded-lg mb-4 dark:bg-gray-700 dark:border-gray-600"
          content="0.00"
          aria-required="true"
        />

        <label className="block mb-2" htmlFor="limit-amount">Amount</label>
        <input
          id="limit-amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full p-3 border rounded-lg mb-4 dark:bg-gray-700 dark:border-gray-600"
          content="0.00"
          aria-required="true"
        />

        <button type="button" onClick={placeOrder}
          disabled={!price || !amount}
          className="w-full bg-blue-600 text-white p-4 rounded-lg btn-touch disabled:opacity-50"
          aria-label="Place limit order"
        >
          Place Limit Order
        </button>
      </section>

      <a href="/" className="mt-4 inline-block text-blue-600 underline btn-touch p-2" aria-label="Back to dashboard">
        Back
      </a>
    </main>
  );
}
