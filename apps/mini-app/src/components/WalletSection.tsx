'use client';

/**
 * Settings → Wallet: the self-custody control panel.
 *
 * - Export private key: the user can ALWAYS take their key and leave. Privy's
 *   export UI runs in an isolated iframe; the key never renders in our DOM.
 * - Bot trading: grant/revoke the session signer that lets the bot execute
 *   chat-confirmed f(x) actions. After every change we POST /wallet/sync so
 *   chat commands reflect the new state immediately.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import {
  usePrivy,
  useLoginWithTelegram,
  useSessionSigners,
  useExportWallet,
  useWallets,
} from '@privy-io/react-auth';
import { haptic } from '@/lib/telegram';
import { apiAvailable, walletSync } from '@/lib/api';
import { privyConfigured, PRIVY_SIGNER_ID } from '@/lib/privyConfig';
import PrivyClientProvider from '@/components/PrivyClientProvider';
import { AddressChip, Button, Card, SectionTitle } from '@/components/ui';

function PrivyWalletControls() {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLoginWithTelegram();
  const { addSessionSigners, removeSessionSigners } = useSessionSigners();
  const { exportWallet } = useExportWallet();
  const { wallets } = useWallets();

  const [busy, setBusy] = useState<'none' | 'login' | 'delegation' | 'export'>('none');
  const [error, setError] = useState('');
  const [delegated, setDelegated] = useState<boolean | null>(null);

  const embedded = useMemo(
    () => wallets.find((w) => w.walletClientType === 'privy'),
    [wallets]
  );
  const walletAccount = useMemo(
    () =>
      user?.linkedAccounts?.find(
        (a) =>
          a.type === 'wallet' &&
          (a as { walletClientType?: string }).walletClientType === 'privy' &&
          (a as { chainType?: string }).chainType === 'ethereum'
      ) as { address?: string; delegated?: boolean } | undefined,
    [user]
  );
  const address = embedded?.address ?? walletAccount?.address;

  useEffect(() => {
    if (delegated === null && walletAccount) setDelegated(Boolean(walletAccount.delegated));
  }, [walletAccount, delegated]);

  const syncBot = useCallback(async () => {
    if (!apiAvailable()) return;
    try {
      const r = await walletSync();
      setDelegated(r.walletDelegated);
    } catch {
      /* fail-soft: bot re-syncs lazily on next command */
    }
  }, []);

  const connect = useCallback(async () => {
    setBusy('login');
    setError('');
    try {
      await login();
    } catch {
      setError('Telegram login failed — close and reopen the app, then try again.');
    } finally {
      setBusy('none');
    }
  }, [login]);

  const toggleDelegation = useCallback(async () => {
    if (!address || !PRIVY_SIGNER_ID) return;
    setBusy('delegation');
    setError('');
    try {
      if (delegated) {
        await removeSessionSigners({ address });
        setDelegated(false);
      } else {
        await addSessionSigners({ address, signers: [{ signerId: PRIVY_SIGNER_ID }] });
        setDelegated(true);
      }
      haptic('success');
      await syncBot();
    } catch (e) {
      haptic('error');
      setError(e instanceof Error && e.message ? e.message : 'Updating bot trading failed.');
    } finally {
      setBusy('none');
    }
  }, [address, delegated, addSessionSigners, removeSessionSigners, syncBot]);

  const handleExport = useCallback(async () => {
    if (!address) return;
    setBusy('export');
    setError('');
    try {
      await exportWallet({ address });
    } catch {
      /* user closed the export modal — not an error */
    } finally {
      setBusy('none');
    }
  }, [address, exportWallet]);

  if (!ready) return null;

  if (!authenticated || !address) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-mut">
          Connect to manage your wallet — export your key or control bot trading.
        </p>
        <Button onClick={connect} loading={busy === 'login'}>
          Connect wallet
        </Button>
        {error && <p className="text-[12.5px] text-warn">{error}</p>}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3">
        <AddressChip address={address} />
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
            {delegated ? (
              <ShieldCheck className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
            ) : (
              <ShieldOff className="h-[18px] w-[18px] text-mut" strokeWidth={2} />
            )}
          </span>
          <span className="flex-1">
            <p className="text-[14px] font-medium">
              Bot trading: {delegated ? 'ON' : 'OFF'}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">
              {delegated
                ? 'The bot can execute the f(x) actions you confirm in chat. Revoke any time — your key never moves.'
                : 'Chat execution is disabled. The bot cannot sign anything for this wallet.'}
            </p>
            {PRIVY_SIGNER_ID ? (
              <Button
                variant={delegated ? 'danger' : 'primary'}
                onClick={toggleDelegation}
                loading={busy === 'delegation'}
                className="mt-3"
              >
                <Bot className="h-4 w-4" />
                {delegated ? 'Revoke bot trading' : 'Enable bot trading'}
              </Button>
            ) : (
              <p className="mt-2 text-[12px] text-warn">
                Operator note: NEXT_PUBLIC_PRIVY_SIGNER_ID is not set in this build.
              </p>
            )}
          </span>
        </div>
      </Card>
      <Card className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
          <KeyRound className="h-[18px] w-[18px] text-mint" strokeWidth={2} />
        </span>
        <span className="flex-1">
          <p className="text-[14px] font-medium">Export private key</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">
            It’s your wallet — take the key anywhere, any time. The key is revealed in a
            secure Privy window, never to FxAeon.
          </p>
          <Button variant="ghost" onClick={handleExport} loading={busy === 'export'} className="mt-3">
            Export key
          </Button>
        </span>
      </Card>
      {error && (
        <Card className="border-[rgba(255,194,75,0.35)]">
          <p className="text-[13px] leading-relaxed text-warn">{error}</p>
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
        <PrivyClientProvider>
          <PrivyWalletControls />
        </PrivyClientProvider>
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
