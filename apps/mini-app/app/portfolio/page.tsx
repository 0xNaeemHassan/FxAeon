'use client';
// NOTE: Consider dynamic() for heavy components in production

import { useEffect, useState } from 'react';
import { useLoading } from '@/components/LoadingProvider';

export default function Portfolio() {
  const { setIsLoading, setLoadingMessage } = useLoading();
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setLoadingMessage('Loading portfolio...');
      try {
        await new Promise(r => setTimeout(r, 1000));
        setPositions([]);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [setIsLoading, setLoadingMessage]);

  return (
    <main className="min-h-screen p-4 tg-mini-app" role="main" aria-label="Portfolio page">
      <h1 className="text-2xl font-bold mb-4" tabIndex={0} id="page-title" aria-labelledby="page-title">Portfolio</h1>
      
      <section aria-label="Positions list">
        {positions.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-8 text-center shadow">
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

            <p className="text-gray-500 dark:text-gray-400">No active positions</p>
            <a href="/trade" className="mt-4 inline-block text-blue-600 underline btn-touch p-2" aria-label="Open trade page">
              Open a Position
            </a>
          </div>
        ) : (
          <ul className="space-y-3" role="list" aria-label="Active positions">
            {positions.map((pos, i) => (
              <li key={i} className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
                Position {i + 1}
              </li>
            ))}
          </ul>
        )}
      </section>

      <a href="/" className="mt-4 inline-block text-blue-600 underline btn-touch p-2" aria-label="Back to dashboard">
        Back
      </a>
    </main>
  );
}
