'use client';

import { useRef } from 'react';
import { useExportWallet } from '@privy-io/react-auth';
import { KeyRound } from 'lucide-react';
import { ActionRow } from '@/components/ProductUI';
import { userSafeError } from '@/lib/errors';

/** Render only for the selected embedded wallet under PrivyProvider. */
export function WalletExportAction({ address, disabled, onStart, onComplete, onError }: {
  address: string;
  disabled: boolean;
  onStart: () => void;
  onComplete: () => void;
  onError: (message: string) => void;
}) {
  const { exportWallet } = useExportWallet();
  const busy = useRef(false);
  const handleExport = async () => {
    if (disabled || busy.current) return;
    busy.current = true;
    // Release the profile's focus trap before Privy opens its secure UI.
    onStart();
    try {
      await exportWallet({ address });
    } catch (cause) {
      if (!(cause instanceof Error) || !/cancel|exit|closed/i.test(cause.message)) {
        onError(userSafeError(cause, 'Wallet export could not be opened. Try again.'));
      }
    } finally {
      busy.current = false;
      onComplete();
    }
  };
  return <ActionRow icon={KeyRound} title="Export wallet" disabled={disabled} onClick={() => void handleExport()} />;
}
