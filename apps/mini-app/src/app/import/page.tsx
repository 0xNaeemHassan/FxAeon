function safeJSONStringify(obj: any): string { try { return JSON.stringify(obj); } catch { return '{}'; } }
'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';
import { ArrowLeft, KeyRound, AlertTriangle, Check, Eye, EyeOff } from 'lucide-react';

export default function ImportPage() {
  const { importWallet } = usePrivy();
  const [isLoading, setIsLoading] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [step, setStep] = useState(1); // 1: input, 2: importing, 3: done
  const [error, setError] = useState('');

  const handleImport = async () => {
    if (!privateKey.trim()) return;
    
    setStep(2);
    setError('');
    
    try {
      // Import via Privy (client-side only)
      await importWallet({ privateKey: privateKey.trim() });
      setStep(3);
      
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.sendData(safeJSONStringify({
          type: 'wallet_imported',
        }));
      }
    } catch (e: any) {
      setError(e.message || 'Import failed');
      setStep(1);
    }
  };

  return (
    <div className="flex min-h-screen flex-col p-4 bg-gray-50">
      <button type="button" onClick={() => window.Telegram?.WebApp?.close()} 
        className="flex items-center text-gray-600 mb-4"
      >
        <ArrowLeft className="w-5 h-5 mr-1" /> Back
      </button>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold">Import Wallet</h1>
        </div>
        <p className="text-sm text-gray-600">
          Import an existing Ethereum wallet. Your private key is encrypted 
          and stored in Privy&apos;s TEE — never on our servers.
        </p>
      </div>

      {/* Warning */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium">Security Notice</p>
            <p className="text-xs mt-1">
              Only enter private keys on this secure page. Never share your 
              key in Telegram chat or with anyone.
            </p>
          </div>
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-600 block mb-2">Private Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                content="0x..."
                className="w-full p-3 border border-gray-200 rounded-lg font-mono text-sm pr-10"
              />
              <button type="button" onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              64 characters, starting with 0x
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <button type="button" onClick={handleImport}
            disabled={!privateKey.trim()}
            className="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            Import Wallet
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="text-center py-8">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-gray-600">Encrypting and importing...</p>
          <p className="text-xs text-gray-400 mt-2">This happens in Privy&apos;s secure enclave</p>
        </div>
      )}

      {step === 3 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <Check className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-green-700 font-medium">Wallet Imported!</p>
          <p className="text-sm text-green-600 mt-1">
            Your wallet is now connected and secured in Privy&apos;s TEE.
          </p>
          <button type="button" onClick={() => window.Telegram?.WebApp?.close()}
            className="mt-3 text-sm text-green-700 underline"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
