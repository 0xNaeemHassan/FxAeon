'use client';
// NOTE: Consider dynamic() for heavy components in production

import { useState } from 'react';
import { useLoading } from '@/components/LoadingProvider';
import { useLoading } from '@/components/LoadingProvider';

export default function Auto() {
  const { setIsLoading } = useLoading();
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<any[]>([]);

  async function addRule() {
    setIsLoading(true);
    try {
      await new Promise(r => setTimeout(r, 1000));
      setRules([...rules, { id: Date.now(), type: 'stop-loss' }]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-4 tg-mini-app" role="main" aria-label="Automation page">
      <h1 className="text-2xl font-bold mb-4" tabIndex={0} id="page-title" aria-labelledby="page-title">Automation</h1>
      
      <section aria-label="Automation rules">
        {rules.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-8 text-center shadow mb-4">
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

            <p className="text-gray-500 dark:text-gray-400">No automation rules</p>
          </div>
        ) : (
          <ul className="space-y-3 mb-4" role="list" aria-label="Active rules">
            {rules.map((rule) => (
              <li key={rule.id} className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
                Rule #{rule.id} - {rule.type}
              </li>
            ))}
          </ul>
        )}

        <button type="button" onClick={addRule}
          className="w-full bg-purple-600 text-white p-4 rounded-lg btn-touch"
          aria-label="Add automation rule"
        >
          Add Rule
        </button>
      </section>

      <a href="/" className="mt-4 inline-block text-blue-600 underline btn-touch p-2" aria-label="Back to dashboard">
        Back
      </a>
    </main>
  );
}
