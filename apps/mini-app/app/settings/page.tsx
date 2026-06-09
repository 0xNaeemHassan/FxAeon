'use client';
// NOTE: Consider dynamic() for heavy components in production

import { useState } from 'react';
import { useLoading } from '@/components/LoadingProvider';

export default function Settings() {
  const [error, setError] = useState<string | null>(null);
  const [slippage, setSlippage] = useState('0.5');
  const [notifications, setNotifications] = useState(true);

  return (
    <main className="min-h-screen p-4 tg-mini-app" role="main" aria-label="Settings page">
      <h1 className="text-2xl font-bold mb-4" tabIndex={0} id="page-title" aria-labelledby="page-title">Settings</h1>
      
      <section aria-label="Trading settings" className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow mb-4">
        <h2 className="font-semibold mb-4">Trading</h2>
        
        <label className="block mb-2" htmlFor="slippage">Max Slippage (%)</label>
        <input
          id="slippage"
          type="number"
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
          className="w-full p-3 border rounded-lg mb-4 dark:bg-gray-700 dark:border-gray-600"
          aria-describedby="slippage-help"
        />
        <p id="slippage-help" className="text-sm text-gray-500 mb-4">
          Maximum acceptable price slippage for trades
        </p>
      </section>

      <section aria-label="Notification settings" className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h2 className="font-semibold mb-4">Notifications</h2>
        
        <label className="flex items-center justify-between">
          <span>Enable notifications</span>
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
            className="w-5 h-5"
            aria-label="Toggle notifications"
          />
        </label>
      </section>

      <a href="/" className="mt-4 inline-block text-blue-600 underline btn-touch p-2" aria-label="Back to dashboard">
        Back
      </a>
    </main>
  );
}
