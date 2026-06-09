'use client';

import { useEffect, useState } from 'react';
import { useLoading } from '@/components/LoadingProvider';

export default function Home() {
  const { setIsLoading, setLoadingMessage } = useLoading();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setLoadingMessage('Loading dashboard...');
      setLoadingMessage('Loading...');
      try {
        // Simulate data loading
        await new Promise(r => setTimeout(r, 1000));
        setData({ positions: 0, balance: '0.00' });
      } catch (error) {
        console.error('Failed to load dashboard:', error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [setIsLoading, setLoadingMessage]);

  if (!data) {
    return (
      <main className="min-h-screen p-4 tg-mini-app" aria-label="Dashboard loading">
        <div className="space-y-4">
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

          <div className="skeleton h-8 w-3/4 rounded" aria-hidden="true" />
          <div className="skeleton h-32 rounded-lg" aria-hidden="true" />
          <div className="skeleton h-32 rounded-lg" aria-hidden="true" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 tg-mini-app" role="main" aria-label="fxBot Dashboard">
      <h1 className="text-2xl font-bold mb-4" tabIndex={0} id="page-title" aria-labelledby="page-title">fxBot Dashboard</h1>
      
      <section aria-label="Portfolio Overview" className="mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <h2 className="text-lg font-semibold mb-2">Portfolio</h2>
          <p className="text-gray-600 dark:text-gray-300">Positions: {data.positions}</p>
          <p className="text-gray-600 dark:text-gray-300">Balance: {data.balance} ETH</p>
        </div>
      </section>

      <nav aria-label="Quick Actions" className="grid grid-cols-2 gap-3">
        <a 
          href="/trade" 
          className="bg-blue-600 text-white p-4 rounded-lg text-center btn-touch"
          aria-label="Open trade page"
        >
          Trade
        </a>
        <a 
          href="/portfolio" 
          className="bg-green-600 text-white p-4 rounded-lg text-center btn-touch"
          aria-label="View portfolio"
        >
          Portfolio
        </a>
        <a 
          href="/settings" 
          className="bg-gray-600 text-white p-4 rounded-lg text-center btn-touch"
          aria-label="Open settings"
        >
          Settings
        </a>
        <a 
          href="/auto" 
          className="bg-purple-600 text-white p-4 rounded-lg text-center btn-touch"
          aria-label="Automation rules"
        >
          Auto
        </a>
      </nav>
    </main>
  );
}
