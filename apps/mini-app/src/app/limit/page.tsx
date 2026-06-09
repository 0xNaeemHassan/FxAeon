'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Suspense } from 'react';
import { ArrowLeft, Target, Check, AlertTriangle } from 'lucide-react';
import { ADDRESSES } from '@fxbot/shared';

const EIP712_DOMAIN = {
  name: "f(x) Limit Order Manager",
  version: "1",
  chainId: 1,
  verifyingContract: ADDRESSES.LIMIT_ORDER_MANAGER,
};

const EIP712_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "pool", type: "address" },
    { name: "positionId", type: "uint256" },
    { name: "positionSide", type: "bool" },
    { name: "orderType", type: "bool" },
    { name: "orderSide", type: "bool" },
    { name: "allowPartialFill", type: "bool" },
    { name: "triggerPrice", type: "uint256" },
    { name: "fxUSDDelta", type: "int256" },
    { name: "collDelta", type: "int256" },
    { name: "debtDelta", type: "int256" },
    { name: "nonce", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

function LimitPageContent() {
  const { ready } = usePrivy();
  const { wallets } = useWallets();
  const searchParams = useSearchParams();
  
  const action = searchParams.get('action') || 'open';
  const market = searchParams.get('market') || 'wstETH';
  const side = searchParams.get('side') || 'long';
  const price = searchParams.get('price') || '2800';
  
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [orderHash, setOrderHash] = useState('');

  const wallet = wallets[0];
  const isLong = side === 'long';
  const isOpen = action === 'open';
  
  // Determine order parameters based on current vs target price
  const currentPrice = 3000; // Would be fetched from API
  const targetPrice = parseFloat(price);
  const isTP = (isLong && targetPrice > currentPrice) || (!isLong && targetPrice < currentPrice);
  
  const poolAddress = isLong 
    ? (market === 'wstETH' ? ADDRESSES.WSTETH_LONG_POOL : ADDRESSES.WBTC_LONG_POOL)
    : (market === 'wstETH' ? ADDRESSES.WSTETH_SHORT_POOL : ADDRESSES.WBTC_SHORT_POOL);

  const handleSign = async () => {
    setStep(2);
    
    try {
      const provider = await wallet.getEthereumProvider();
      
      const order = {
        maker: wallet.address,
        pool: poolAddress,
        positionId: 0, // 0 = new position
        positionSide: isLong,
        orderType: !isOpen, // false = open, true = close
        orderSide: isTP,
        allowPartialFill: false,
        triggerPrice: BigInt(Math.floor(targetPrice * 1e18)),
        fxUSDDelta: 0,
        collDelta: 0,
        debtDelta: 0,
        nonce: Date.now(),
        salt: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
        deadline: Math.floor(Date.now() / 1000) + 86400, // 24h
      };
      
      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [wallet.address, JSON.stringify({
          domain: EIP712_DOMAIN,
          types: EIP712_TYPES,
          primaryType: 'Order',
          message: order,
        })],
      });
      
      // Submit to relayer
      const res = await fetch('https://fx-limit-order-api.aladdin.club/v1/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderHash: '0x...', // Compute from order
          data: order,
          signature,
        }),
      });
      
      const data = await res.json();
      setOrderHash(data.orderHash || 'submitted');
      setStep(3);
      
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.sendData(JSON.stringify({
          type: 'limit_order_signed',
          orderHash: data.orderHash,
          market,
          side,
          action,
          price: targetPrice,
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
          <h1 className="text-xl font-bold">Limit Order</h1>
          <div className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-medium">
            <Target className="w-4 h-4 inline mr-1" />
            {isTP ? 'Take Profit' : 'Stop Loss'}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-600">Action</span>
            <span className="font-medium">{action.toUpperCase()} {market} {side.toUpperCase()}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-600">Trigger Price</span>
            <span className="font-medium">${targetPrice}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-600">Current Price</span>
            <span className="font-medium">${currentPrice}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-600">Pool</span>
            <span className="font-mono text-xs">{poolAddress.slice(0, 8)}...{poolAddress.slice(-6)}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-600">Wallet</span>
            <span className="font-mono text-xs">{wallet?.address?.slice(0, 6)}...{wallet?.address?.slice(-4)}</span>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
        <p className="text-xs text-gray-500">
          EIP-712 Domain: {EIP712_DOMAIN.name} v{EIP712_DOMAIN.version}
          <br />
          Contract: {EIP712_DOMAIN.verifyingContract.slice(0, 10)}...
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">Signing Error</p>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <button type="button" onClick={handleSign}
          className="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-primary/90"
        >
          Sign EIP-712 & Submit
        </button>
      )}

      {step === 2 && (
        <div className="text-center py-4">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-gray-600">Signing limit order...</p>
        </div>
      )}

      {step === 3 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <Check className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-green-700 font-medium">Limit Order Submitted!</p>
          <p className="text-sm text-green-600 mt-1">Order hash: {orderHash.slice(0, 20)}...</p>
          <p className="text-xs text-gray-500 mt-2">
            f(x) keepers will fill this order when the trigger price is reached.
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

export default function LimitPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
      <LimitPageContent />
    </Suspense>
  );
}
