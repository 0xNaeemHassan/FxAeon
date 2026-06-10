'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, Shield, Wallet } from 'lucide-react';

interface Position {
  tokenId: string;
  market: string;
  side: 'long' | 'short';
  collateral: string;
  debt: string;
  leverage: number;
  healthPercent: number;
  liquidationPrice: number;
}

export default function PortfolioPage() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [fxSaveBalance, setFxSaveBalance] = useState('0.00');
  const [fxnBalance, setFxnBalance] = useState('0.00');

  const wallet = wallets[0];

  useEffect(() => {
    if (ready && !authenticated) {
      router.replace('/login');
      return;
    }
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (!wallet) {
      setLoading(false);
      return;
    }
    
    const fetchData = async () => {
      try {
        // TODO: Replace with real fx-sdk calls when contracts are integrated
        // For now show actual empty state — no mock data
        setPositions([]);
        setFxSaveBalance('0.00');
        setFxnBalance('0.00');
      } catch (e) {
        console.error('Failed to fetch portfolio data:', e);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [wallet]);

  const handleBack = () => {
    if (window.Telegram?.WebApp?.initData) {
      window.Telegram.WebApp.close();
    } else {
      router.back();
    }
  };

  const getHealthColor = (health: number) => {
    if (health >= 0.95) return 'text-red-500';
    if (health >= 0.85) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getHealthBg = (health: number) => {
    if (health >= 0.95) return 'bg-red-50 border-red-200';
    if (health >= 0.85) return 'bg-yellow-50 border-yellow-200';
    return 'bg-green-50 border-green-200';
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
      <button type="button" onClick={handleBack}
        className="flex items-center text-gray-600 dark:text-gray-300 mb-4"
      >
        <ArrowLeft className="w-5 h-5 mr-1" /> Back
      </button>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Wallet className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold dark:text-white">Portfolio</h1>
        </div>
        {wallet?.address ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">
            {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
          </p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No wallet connected
          </p>
        )}
      </div>

      {/* Balances */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">fxSAVE Balance</p>
          <p className="text-lg font-bold text-primary">{fxSaveBalance} fxUSD</p>
          <p className="text-xs text-green-600">~7.1% APY</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">FXN Balance</p>
          <p className="text-lg font-bold dark:text-white">{fxnBalance} FXN</p>
          <p className="text-xs text-gray-400">Governance token</p>
        </div>
      </div>

      {/* Positions */}
      <h2 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Positions</h2>
      
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading positions...</p>
        </div>
      ) : positions.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 text-center">
          <p className="text-gray-500 dark:text-gray-400 mb-2">No active positions</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Open a leveraged position on f(x) Protocol to get started
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {positions.map((pos) => (
            <div key={pos.tokenId} className={`rounded-xl border p-4 ${getHealthBg(pos.healthPercent)}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {pos.side === 'long' ? (
                    <TrendingUp className="w-5 h-5 text-green-600" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-red-600" />
                  )}
                  <span className="font-medium">{pos.market} {pos.side.toUpperCase()}</span>
                </div>
                <span className="text-sm font-bold">{pos.leverage}x</span>
              </div>
              
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Collateral</span>
                  <span>{pos.collateral} ETH</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Debt</span>
                  <span>{pos.debt} fxUSD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Health</span>
                  <span className={getHealthColor(pos.healthPercent)}>
                    {(pos.healthPercent * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Liquidation</span>
                  <span className="text-red-500">${pos.liquidationPrice}</span>
                </div>
              </div>

              {pos.healthPercent >= 0.85 && (
                <div className="flex items-center gap-1 mt-2 text-xs text-red-600">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Health warning — consider reducing leverage</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Security badge */}
      <div className="mt-4 flex items-center justify-center gap-1 text-xs text-gray-400">
        <Shield className="w-4 h-4" />
        <span>Non-custodial · Keys in Privy TEE</span>
      </div>
    </div>
  );
}
