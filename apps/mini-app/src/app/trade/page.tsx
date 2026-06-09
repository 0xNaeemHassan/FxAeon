'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, Check } from 'lucide-react';

export default function TradePage() {
  const { user, ready } = usePrivy();
  const { wallets } = useWallets();
  const searchParams = useSearchParams();
  
  const market = searchParams.get('market') || 'wstETH';
  const side = searchParams.get('side') || 'long';
  const leverage = parseFloat(searchParams.get('lev') || '3');
  const amount = searchParams.get('amt') || '1';
  
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: confirm, 2: simulating, 3: signing, 4: done
  const [simResult, setSimResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');

  const wallet = wallets[0];
  const isLong = side === 'long';
  const maxLev = isLong ? 7 : 3;
  const isValid = leverage >= 1.1 && leverage <= maxLev;

  useEffect(() => {
    if (!ready || !wallet) return;
    
    // Pre-flight simulation
    const simulate = async () => {
      try {
        // Call backend simulation endpoint
        const res = await fetch('/api/simulate-trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: wallet.address,
            market,
            side,
            leverage,
            amount,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setSimResult(data);
        } else {
          setError(data.error || 'Simulation failed');
        }
      } catch (e: any) {
        setError(e.message);
      }
    };
    
    simulate();
  }, [ready, wallet, market, side, leverage, amount]);

  const handleConfirm = async () => {
    setStep(2);
    
    try {
      // Sign and send via Privy
      const provider = await wallet.getEthereumProvider();
      
      // Build tx from fx-sdk plan
      const tx = {
        to: '0x33636D49FbefBE798e15e7F356E8DBef543CC708', // Router
        data: '0x', // Would be encoded from fx-sdk
        value: '0x0',
      };
      
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [tx],
      });
      
      setTxHash(hash);
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
    } catch (e: any) {
      setError(e.message);
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
    <div className="flex min-h-screen flex-col p-4 bg-gray-50">
      <button type="button" onClick={() => window.Telegram?.WebApp?.close()} 
        className="flex items-center text-gray-600 mb-4"
      >
        <ArrowLeft className="w-5 h-5 mr-1" /> Back
      </button>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold">{isLong ? 'Open Long' : 'Open Short'}</h1>
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            isLong ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {isLong ? <TrendingUp className="w-4 h-4 inline mr-1" /> : <TrendingDown className="w-4 h-4 inline mr-1" />}
            {side.toUpperCase()}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-600">Market</span>
            <span className="font-medium">{market}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-600">Leverage</span>
            <span className="font-medium">{leverage}x</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-600">Collateral</span>
            <span className="font-medium">{amount} ETH</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-600">Wallet</span>
            <span className="font-mono text-sm">{wallet?.address?.slice(0, 6)}...{wallet?.address?.slice(-4)}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">Transaction Error</p>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        </div>
      )}

      {simResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-blue-700">
            <Check className="w-4 h-4 inline mr-1" />
            Simulation successful. Gas estimate: {simResult.gasEstimate}
          </p>
        </div>
      )}

      {!isValid && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-yellow-700">
            <AlertTriangle className="w-4 h-4 inline mr-1" />
            Leverage must be between 1.1x and {maxLev}x for {side}
          </p>
        </div>
      )}

      {step === 1 && (
        <button type="button" onClick={handleConfirm}
          disabled={!isValid || !!error}
          className="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Confirm & Sign
        </button>
      )}

      {step === 2 && (
        <div className="text-center py-4">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-gray-600">Simulating transaction...</p>
        </div>
      )}

      {step === 4 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <Check className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-green-700 font-medium">Transaction Submitted!</p>
          <p className="text-sm text-green-600 mt-1 break-all">{txHash}</p>
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
