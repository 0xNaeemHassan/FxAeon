'use client';

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { userSafeError } from '@/lib/errors';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet } from '@/lib/wallet';

type ConnectWalletButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'type'> & {
  children: ReactNode;
  onConnectStart?: () => void;
  onConnected?: () => void | Promise<void>;
  onConnectError?: () => void;
  /** Complete a queued action when the wallet authenticated during hydration. */
  resumeIfConnected?: boolean;
};

/** Opens the configured wallet selector over the current route. */
export default function ConnectWalletButton({ children, className = '', disabled, onConnectStart, onConnected, onConnectError, resumeIfConnected = false, ...props }: ConnectWalletButtonProps) {
  const wallet = usePrivyWallet();
  const { connect: connectWallet, ready, authenticated, address } = wallet;
  const [connecting, setConnecting] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState('');
  const connectingRef = useRef(false);
  const queuedRef = useRef(false);

  const connectNow = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    queuedRef.current = false;
    setQueued(false);
    setConnecting(true);
    setError('');
    try {
      // A Telegram/Privy launch can finish between the click and provider
      // readiness. Treat that as the requested connection completing; opening
      // the selector again would be a surprising second prompt and strands
      // action rails that are waiting to resume.
      if (resumeIfConnected && authenticated && address) {
        await onConnected?.();
        haptic('success');
        return;
      }
      // Telegram WebViews do not expose an injected browser wallet reliably.
      // The adapter owns the seamless Privy launch-data flow and fails with a
      // Telegram-specific message when it is not available. Keep the CTA
      // route-stable; normal browsers retain explicit EIP-1193 discovery.
      await connectWallet();
      await onConnected?.();
      haptic('success');
    } catch (cause) {
      onConnectError?.();
      const message = userSafeError(cause, 'Wallet connection was cancelled.');
      setError(message);
      haptic('error');
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [address, authenticated, connectWallet, onConnectError, onConnected, resumeIfConnected]);

  // Provider hydration is intentionally asynchronous (Privy and browser
  // EIP-6963 discovery both settle after the shell can render). A click made
  // during that window is a user intent, not an error: replay it once the
  // adapter is ready so the user never has to click twice.
  useEffect(() => {
    if (!queued || connectingRef.current || (!ready && !(resumeIfConnected && authenticated && address))) return;
    void connectNow();
  }, [address, authenticated, connectNow, queued, ready, resumeIfConnected]);

  const connect = () => {
    if (connectingRef.current || queuedRef.current || queued) return;
    setError('');
    queuedRef.current = true;
    setQueued(true);
    onConnectStart?.();
    if (ready) void connectNow();
  };

  const opening = queued || connecting;
  // A disabled action is a deliberate product constraint, not a provider
  // hydration state. Respect it at every readiness stage so an invalid form
  // cannot queue a connection that later auto-submits a different action.
  const isDisabled = opening || Boolean(disabled);

  return (
    <>
      <button
        {...props}
        type="button"
        className={className}
        disabled={isDisabled}
        aria-busy={opening || undefined}
        onClick={() => void connect()}
      >
        {opening && <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />}
        {opening ? 'Opening wallet…' : children}
      </button>
      {error && <span role="alert" className="wallet-connect-toast">{error}</span>}
    </>
  );
}
