'use client';
// NOTE: Consider dynamic() for heavy components in production

import { useState } from 'react';
import { useLoading } from '@/components/LoadingProvider';
import { useLoading } from '@/components/LoadingProvider';

export default function Import() {
  const { setIsLoading } = useLoading();
  const [error, setError] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState('');

  async function handleImport() {
    setIsLoading(true);
    try {
      await new Promise(r => setTimeout(r, 1500));
      alert('Wallet imported!');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-4 tg-mini-app" role="main" aria-label="Import wallet page">
      <h1 className="text-2xl font-bold mb-4" tabIndex={0} id="page-title" aria-labelledby="page-title">Import Wallet</h1>
      
      <section aria-label="Import form" className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <label className="block mb-2" htmlFor="mnemonic">Seed Phrase</label>
        <textarea
          id="mnemonic"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          className="w-full p-3 border rounded-lg mb-4 h-32 dark:bg-gray-700 dark:border-gray-600"
          content="Enter your 12 or 24 word seed phrase..."
          aria-required="true"
        />

        <button type="button" onClick={handleImport}
          disabled={!mnemonic}
          className="w-full bg-blue-600 text-white p-4 rounded-lg btn-touch disabled:opacity-50"
          aria-label="Import wallet"
        >
          Import
        </button>
      </section>

      <a href="/" className="mt-4 inline-block text-blue-600 underline btn-touch p-2" aria-label="Back to dashboard">
        Back
      </a>
    </main>
  );
}
