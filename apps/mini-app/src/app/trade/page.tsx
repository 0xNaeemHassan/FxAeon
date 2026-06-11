'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Suspense } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, Check } from 'lucide-react';
import { getWebApp, isTMA, showMainButton } from '@/lib/telegram';

const MARKET_INDEX: Record<string, number> = { wstETH: 0, WBTC: 1 };
const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'FxAeonBot';

/**
 * W-17: the Mini App never executes trades itself (see EXECUTION_LIVE
 * kill-switch below). Confirmation happens in the bot chat: this deep link
 * carries the params (`tq_*`, unsigned — the bot re-validates and re-signs
 * them server-side) and opens a signed preview with inline Confirm/Cancel.
 */
function buildBotDeepLink(market: string, side: string, leverage: number, amount: string): string | null {
  const mIdx = MARKET_INDEX[market];
  const amt = parseFloat(amount);
  if (mIdx === undefined || !Number.isFinite(leverage) || !(amt > 0)) return null;
  const payload = `tq_${mIdx}_${side === 'short' ? 's' : 'l'}_${Math.round(leverage * 10)}_${Math.round(amt * 1e6)}`;
  return `https://t.me/${BOT_USERNAME}?start=${payload}`;
}

function TradePageContent() {
  const { ready } = usePrivy();
  const { wallets } = useWallets();
  const searchParams = useSearchParams();
  
  const market = searchParams.get('market') || 'wstETH';
  const side = searchParams.get('side') || 'long';
  const leverage = parseFloat(searchParams.get('lev') || '3');
  const amount = searchParams.get('amt') || '1';
  
  const [step] = useState(1); // 1: confirm, 2: simulating, 3: signing, 4: done
  const [error] = useState('');
  const [txHash] = useState('');

  const wallet = wallets[0];
  const isLong = side === 'long';
  const maxLev = isLong ? 7 : 3;
  const isValid = leverage >= 1.1 && leverage <= maxLev;

  // SAFETY KILL-SWITCH (see docs/audit/AUDIT.md P0-2):
  // The previous implementation broadcast an empty-calldata transaction to the
  // Router (user pays gas for a no-op) and reported a fake success back to the
  // bot. Execution stays disabled until real fx-sdk calldata + a passing
  // simulateContract gate exist (PLAN.md W-07). Do not re-enable without both.
  const EXECUTION_LIVE = false;

  // W-17: native MainButton confirm — opens the bot chat with a deep link;
  // the bot renders a signed preview and executes server-side on Confirm.
  const deepLink = isValid ? buildBotDeepLink(market, side, leverage, amount) : null;
  const openInBot = () => {
    if (!deepLink) return;
    const tg = getWebApp();
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(deepLink);
      tg.close();
    } else {
      window.open(deepLink, '_blank', 'noopener');
    }
  };

  useEffect(() => {
    if (!isTMA() || !deepLink) return;
    return showMainButton('Confirm in Telegram', openInBot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink]);

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
            <span className="font-medium">{amount} {market}</span>
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
        <>
          {!EXECUTION_LIVE && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-700 dark:text-blue-400">
                <AlertTriangle className="w-4 h-4 inline mr-1" />
                Trades execute in the bot chat — simulation-gated, nothing is
                sent from this page. Tap below to review and confirm.
              </p>
            </div>
          )}
          <button type="button"
            onClick={openInBot}
            disabled={!deepLink}
            className="w-full btn-touch bg-primary text-white py-3 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm in Telegram
          </button>
        </>
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
