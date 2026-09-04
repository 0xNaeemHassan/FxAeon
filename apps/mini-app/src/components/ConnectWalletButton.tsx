'use client';

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { userSafeError } from '@/lib/errors';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';

type ConnectWalletButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'type'> & {
  children: ReactNode;
};

/** Opens the configured wallet selector over the current route. */
export default function ConnectWalletButton({ children, className = '', disabled, ...props }: ConnectWalletButtonProps) {
  const wallet = usePrivyWallet();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    setError('');
    setConnecting(true);
    try {
      await wallet.connect();
      haptic('success');
    } catch (cause) {
      const message = userSafeError(cause, 'Wallet connection was cancelled or unavailable.');
      setError(message);
      haptic('error');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <>
      <button
        {...props}
        type="button"
        className={className}
        disabled={disabled || connecting || !wallet.ready}
        aria-busy={connecting || undefined}
        onClick={() => void connect()}
      >
        {connecting && <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />}
        {children}
      </button>
      {error && <span role="alert" className="wallet-connect-toast">{error}</span>}
    </>
  );
}
