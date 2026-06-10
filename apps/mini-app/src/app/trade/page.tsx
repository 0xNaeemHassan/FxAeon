'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Suspense } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, Check } from 'lucide-react';

function TradePageContent() {
  const { ready } = usePrivy();
  const { wallets } = useWallets();
  const searchParams = useSearchParams();
  
  const market = searchParams.get('market') || 'wstETH';
  const side = searchParams.get('side') || 'long';
  const leverage = parseFloat(searchParams.get('lev') || '3');
  const amount = searchParams.get('amt') || '1';
  
  const [step, setStep] = useState(1); // 1: confirm, 2: simulating, 3: signing, 4: done
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');

  const wallet = wallets[0];
  const isLong = side === 'long';
  const maxLev = isLong ? 7 : 3;
  const isValid = leverage >= 1.1 && leverage <= maxLev;

  const handleConfirm = async () => {
    if (!wallet) {
      setError('No wallet connected. Please log in first.');
      return;
    }
    
    setStep(2);
    setError('');
    
    try {
      const provider = await wallet.getEthereumProvider();
      
      // Build tx from fx-sdk plan
      // TODO: Replace with real fx-sdk encoded calldata when backend is ready
      const tx = {
        to: '0x33636D49FbefBE798e15e7F356E8DBef543CC708', // Router
        data: '0x', // Would be encoded from fx-sdk
        value: '0x0',
        from: wallet.address,
      };
      
      setStep(3);
      
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [tx],
      });
      
      setTxHash(hash as string);
      setStep(4);
      
      // Send back to Telegram
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.sendData(JSON.stringify({
          type: 'trade_executed',
          hash,
          market,
          side,
          leverage,
          amount,
        }));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Don't show error for user rejections
      if (msg.includes('user rejected') || msg.includes('User denied')) {
        setError('Transaction cancelled.');
      } else {
        setError(msg);
      }
      setStep(1);
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col p-4 bg-gray-50 dark:bg-slate-900">
      <button type="button" onClick={() => window.history.back()} 
        className="flex items-center text-gray-600 dark:text-gray-400 mb-4"
      >
        <ArrowLeft className="w-5 h-5 mr-1" /> Back
      </button>

      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold">{isLong ? 'Open Long' : 'Open Short'}</h1>
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            isLong ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}>
            {isLong ? <TrendingUp className="w-4 h-4 inline mr-1" /> : <TrendingDown className="w-4 h-4 inline mr-1" />}
            {side.toUpperCase()}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-700">
            <span className="text-gray-600 dark:text-gray-400">Market</span>
            <span className="font-medium">{market}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-700">
            <span className="text-gray-600 dark:text-gray-400">Leverage</span>
            <span className="font-medium">{leverage}x</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-700">
            <span className="text-gray-600 dark:text-gray-400">Collateral</span>
            <span className="font-medium">{amount} ETH</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-700">
            <span className="text-gray-600 dark:text-gray-400">Wallet</span>
            <span className="font-mono text-sm">
              {wallet?.address
                ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
                : 'Not connected'}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">Error</p>
              <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
            </div>
          </div>
        </div>
      )}

      {!isValid && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4">
          <p className="text-sm text-yellow-700 dark:text-yellow-400">
            <AlertTriangle className="w-4 h-4 inline mr-1" />
            Leverage must be between 1.1x and {maxLev}x for {side}
          </p>
        </div>
      )}

      {!wallet && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4">
          <p className="text-sm text-yellow-700 dark:text-yellow-400">
            <AlertTriangle className="w-4 h-4 inline mr-1" />
            No wallet connected. Please log in first.
          </p>
        </div>
      )}

      {step === 1 && (
        <button type="button" onClick={handleConfirm}
          disabled={!isValid || !wallet}
          className="w-full btn-touch bg-primary text-white py-3 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Confirm & Sign
        </button>
      )}

      {(step === 2 || step === 3) && (
        <div className="text-center py-4">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-gray-600 dark:text-gray-400">
            {step === 2 ? 'Preparing transaction...' : 'Waiting for signature...'}
          </p>
        </div>
      )}

      {step === 4 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 text-center">
          <Check className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-green-700 dark:text-green-400 font-medium">Transaction Submitted!</p>
          <p className="text-sm text-green-600 dark:text-green-300 mt-1 break-all font-mono">{txHash}</p>
          <a 
            href={`https://etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 text-sm text-green-700 dark:text-green-400 underline inline-block"
          >
            View on Etherscan ↗
          </a>
        </div>
      )}
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
      <TradePageContent />
    </Suspense>
  );
}
