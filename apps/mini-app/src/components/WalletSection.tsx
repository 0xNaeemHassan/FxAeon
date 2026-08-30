'use client';

/**
 * Settings → Wallet: a client-only, user-controlled wallet panel.
 *
 * This component deliberately contains no API calls, private-key fields,
 * delegation controls, signer policy, or bot execution settings. Privy owns
 * wallet custody and every protocol transaction is approved by the selected
 * wallet at the time it is submitted.
 */
import { useCallback, useMemo, useState } from 'react';
import { KeyRound, Plus, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useConnectWallet,
  useCreateWallet,
  useExportWallet,
  usePrivy,
  useWallets,
} from '@privy-io/react-auth';
import { haptic } from '@/lib/telegram';
import { usePrivyWallet, useWalletReadyTimeout } from '@/lib/wallet';
import { privyConfigured } from '@/lib/privyConfig';
import { userSafeError } from '@/lib/errors';
import { AddressChip, Button, Card, SectionTitle } from '@/components/ui';

function PrivyWalletControls() {
  const router = useRouter();
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { address, selectedWallet, selectWallet } = usePrivyWallet();
  const { connectWallet } = useConnectWallet();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const [busy, setBusy] = useState<'none' | 'create' | 'connect' | 'export'>('none');
  const [error, setError] = useState('');
  const readyTimedOut = useWalletReadyTimeout(ready);

  const embedded = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === 'privy' || wallet.walletClientType === 'privy-v2'),
    [wallets]
  );
  const externalWallets = useMemo(
    () => wallets.filter((wallet) => wallet.type === 'ethereum' && wallet.walletClientType !== 'privy' && wallet.walletClientType !== 'privy-v2'),
    [wallets]
  );

  const handleCreate = useCallback(async () => {
    if (!authenticated) {
      router.push('/login');
      return;
    }
    setBusy('create');
    setError('');
    try {
      await createWallet();
      haptic('success');
    } catch (cause) {
      setError(userSafeError(cause, 'Wallet creation was cancelled or unavailable.'));
      haptic('error');
    } finally {
      setBusy('none');
    }
  }, [authenticated, createWallet, router]);

  const handleConnect = useCallback(() => {
    if (!authenticated) {
      router.push('/login');
      return;
    }
    setBusy('connect');
    setError('');
    connectWallet();
    // Privy owns the modal lifecycle; callbacks update the wallet list. Keep
    // this button from remaining visually busy if the user closes the modal.
    window.setTimeout(() => setBusy('none'), 500);
  }, [authenticated, connectWallet, router]);

  const handleExport = useCallback(async () => {
    if (!embedded?.address) return;
    setBusy('export');
    setError('');
    try {
      // Privy renders the export UI in its own isolated surface; the key is
      // never returned to FxAeon or placed in React state/DOM.
      await exportWallet({ address: embedded.address });
    } catch (cause) {
      // Closing the modal is expected. Surface other failures for recovery.
      if (cause instanceof Error && !/cancel|exit|closed/i.test(cause.message)) {
        setError(userSafeError(cause, 'Wallet export is temporarily unavailable.'));
      }
    } finally {
      setBusy('none');
    }
  }, [embedded?.address, exportWallet]);

  if (!ready) {
    if (readyTimedOut) return <div role="alert"><Card><p className="text-[13px] font-semibold">Wallet did not load</p><p className="mt-1 text-[12px] leading-relaxed text-mut">Check your connection or reopen FxAeon.</p><Button onClick={() => window.location.reload()} className="mt-3">Reload wallet</Button></Card></div>;
    return <Card className="h-24 animate-pulse"><span className="sr-only">Loading wallet provider</span></Card>;
  }

  if (!authenticated) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-mut">
          Connect a wallet to view your account and use FxAeon.
        </p>
        <Button onClick={() => router.push('/login')}>Connect wallet</Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3">
        <p className="text-[12px] font-medium text-mut">Selected wallet</p>
        {selectedWallet?.address && <AddressChip address={selectedWallet.address} />}
        {wallets.length > 1 && (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] font-medium text-mut">Connected wallets</p>
            {wallets.filter((wallet) => wallet.type === 'ethereum').map((wallet) => (
              <button
                key={wallet.address}
                type="button"
                onClick={() => selectWallet(wallet.address)}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors ${
                  address?.toLowerCase() === wallet.address.toLowerCase()
                    ? 'border-[var(--mint)] bg-[var(--mint-dim)]'
                    : 'border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--mint)]'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium">{wallet.walletClientType ?? 'Ethereum wallet'}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-mut">{wallet.address}</span>
                </span>
                {address?.toLowerCase() === wallet.address.toLowerCase() && <span className="text-[11px] text-mint">Selected</span>}
              </button>
            ))}
          </div>
        )}
      </Card>

      {!embedded && (
        <Card className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
            <Plus className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
          </span>
          <span className="flex-1">
            <p className="text-[14px] font-medium">Create wallet</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">Add a wallet secured by Privy to this account.</p>
            <Button onClick={handleCreate} loading={busy === 'create'} className="mt-3">Create wallet</Button>
          </span>
        </Card>
      )}

      <Card className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
          <Wallet className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
        </span>
        <span className="flex-1">
          <p className="text-[14px] font-medium">Connect another wallet</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">
            Use another EVM wallet with FxAeon.
          </p>
          <Button variant="ghost" onClick={handleConnect} loading={busy === 'connect'} className="mt-3">
            Connect external wallet
          </Button>
        </span>
      </Card>

      {embedded && (
        <Card className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
            <KeyRound className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
          </span>
          <span className="flex-1">
            <p className="text-[14px] font-medium">Export wallet</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">Open Privy&apos;s secure export flow.</p>
            <Button variant="ghost" onClick={handleExport} loading={busy === 'export'} className="mt-3">
              Export wallet
            </Button>
          </span>
        </Card>
      )}

      {externalWallets.length > 0 && (
        <p className="text-[11px] leading-relaxed text-mut">
          {externalWallets.length} external Ethereum wallet{externalWallets.length === 1 ? '' : 's'} connected.
        </p>
      )}
      {error && (
        <Card className="border-[rgba(255,194,75,0.35)]">
          <p role="alert" className="text-[13px] leading-relaxed text-warn">{error}</p>
        </Card>
      )}
    </div>
  );
}
export default function WalletSection() {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>Wallet</SectionTitle>
      {privyConfigured() ? (
        <PrivyWalletControls />
      ) : (
        <Card>
          <p className="text-[13px] leading-relaxed text-mut">
            Wallet controls are unavailable: this build is missing its Privy configuration.
          </p>
        </Card>
      )}
    </section>
  );
}
