'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { formatEther, formatUnits, isAddress, type Address } from 'viem';
import { ArrowLeft, ArrowUpRight, ChevronRight, Clock3, Wallet } from 'lucide-react';
import { AppShell } from '@/components/ui';
import TokenIcon, { ChainIcon } from '@/components/TokenIcon';
import { GroupedAddress } from '@/components/GroupedAddress';
import { WalletAvatar } from '@/components/WalletAvatar';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { useWalletAssets } from '@/components/WalletDataProvider';
import { useWalletDemand } from '@/components/WalletDemandProvider';
import { usePrivyWallet } from '@/lib/wallet';
import { prepareWalletSend, type SendInput, type SendQuote } from '@/lib/walletSend';
import { recordPendingHash } from '@/lib/fx/journal';
import { withWalletChainLock } from '@/lib/fx/lock';
import { GAS_TIERS, readGasTier, type GasTier } from '@/lib/settings';
import { userSafeError } from '@/lib/errors';
import { canonicalAsset } from '@/lib/walletAssets';
import { decimalInputError, decimalToUnits, formatSignificantDecimal } from '@/lib/amount';
import { formatUsd } from '@/lib/prices';
import { displayAssetSymbol } from '@/components/AssetPresentation';
import { WalletAssetPicker } from '@/components/WalletAssetPicker';
import styles from './send.module.css';
const SEND_DEMAND = { expandedAssets: true, chainPulse: true, positions: false } as const;

const networkName = (chainId: number) => (chainId === 1 ? 'Ethereum' : 'Base');
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export default function SendPage() {
  const wallet = usePrivyWallet();
  return <AppShell title="Send">{wallet.address
    ? <SendForm key={`${wallet.address.toLowerCase()}:${wallet.connectionVersion}`} />
    : <WalletConnectCTA compact ready={wallet.ready} authenticated={wallet.authenticated} body="Connect a wallet to send." />}</AppShell>;
}

function SendForm() {
  const wallet = usePrivyWallet();
  useWalletDemand(SEND_DEMAND, wallet.ready && Boolean(wallet.address));
  const assets = useWalletAssets({ address: wallet.address, enabled: wallet.ready && Boolean(wallet.address) });
  const tokens = assets.data?.assets.filter((asset) => asset.balanceWei > 0n && canonicalAsset(asset.chainId, asset.tokenAddress)) ?? [];
  const [assetId, setAssetId] = useState('');
  const asset = tokens.find((item) => item.id === assetId) ?? tokens[0];
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [tier, setTier] = useState<GasTier>(readGasTier);
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const speedLabelId = useId();
  const recipientHintId = useId();
  const mounted = useRef(true);
  const identity = `${wallet.address?.toLowerCase()}:${wallet.connectionVersion}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && currentIdentity.current === identity;
  const trimmedRecipient = recipient.trim();
  const recipientValid = isAddress(trimmedRecipient);
  const input = (value = amount, to = trimmedRecipient): SendInput => {
    if (!asset || !wallet.address || !isAddress(to)) throw new Error('Enter a valid recipient address.');
    return { walletAddress: wallet.address as Address, recipient: to as Address, chainId: asset.chainId, tokenAddress: asset.tokenAddress,
      amount: value, tier: wallet.isEmbedded ? tier : 'standard' };
  };
  const symbol = asset ? displayAssetSymbol(asset.symbol) : '';
  const trimmedAmount = amount.trim();
  const amountProblem = asset && trimmedAmount ? decimalInputError(trimmedAmount, asset.decimals) : null;
  const amountUnits = asset && trimmedAmount && !amountProblem ? decimalToUnits(trimmedAmount, asset.decimals) : null;
  // The action names the one thing still missing, so a disabled button is never a mystery.
  const blocker = !asset ? (assets.status === 'loading' || assets.status === 'idle' ? 'Loading assets' : 'No assets to send')
    : !trimmedAmount ? 'Enter an amount'
      : amountUnits === null ? 'Enter a valid amount'
        : amountUnits > asset.balanceWei ? `Insufficient ${symbol}`
          : !trimmedRecipient ? 'Enter a recipient'
            : !recipientValid ? 'Enter a valid address'
              : null;
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (cause) { if (current()) setError(userSafeError(cause, 'Transfer could not be prepared. Try again.')); }
    finally { lock.current = false; if (current()) setBusy(false); }
  };
  const maximum = () => void run(async () => {
    if (!asset) return;
    if (asset.tokenAddress || !wallet.address) { setAmount(asset.balance); return; }
    // Until a recipient is entered, cost a transfer back to this wallet. A plain ETH
    // transfer costs the same, and review re-quotes the real recipient before signing.
    const estimate = await prepareWalletSend(input('0.000000000000000001', recipientValid ? trimmedRecipient : wallet.address));
    if (!current()) return;
    const reserve = estimate.requiredNative - 1n;
    if (asset.balanceWei <= reserve) throw new Error('Not enough ETH for network cost.');
    setAmount(formatUnits(asset.balanceWei - reserve, asset.decimals));
  });
  const review = () => void run(async () => {
    const result = await prepareWalletSend(input());
    if (current()) setQuote(result);
  });
  const confirm = () => void run(async () => {
    if (!quote || !current()) return;
    await withWalletChainLock({ walletAddress: quote.input.walletAddress, chainId: quote.input.chainId, requireWebLocks: true, run: async (assertOwned) => {
    if (!current()) return;
    // Rebuild only from the immutable reviewed input. A changed account cannot sign it.
    const fresh = await prepareWalletSend(quote.input);
    if (!current()) return;
    if (fresh.requiredNative > quote.requiredNative) {
      setQuote(fresh); throw new Error('Network cost changed. Review the updated amount.');
    }
    assertOwned();
    const result = await wallet.sendTransaction({ from: quote.input.walletAddress, chainId: quote.input.chainId, to: fresh.to, data: fresh.data, value: fresh.value, nonce: fresh.nonce,
      ...(wallet.isEmbedded ? { nonce: fresh.nonce, gasLimit: fresh.gas, maxFeePerGas: fresh.maxFeePerGas, maxPriorityFeePerGas: fresh.maxPriorityFeePerGas } : {}) },
    { description: `Send ${quote.input.amount} ${quote.symbol} to ${quote.input.recipient}`, action: 'Send', buttonText: 'Confirm' });
    // Submission belongs to the account that signed, even if the active account changed while its prompt was open.
    recordPendingHash({ operation: 'sendAsset', stepKind: 'action', intent: 'Send', walletAddress: quote.input.walletAddress,
      chainId: quote.input.chainId, hash: result.hash, to: fresh.to, data: fresh.data, value: fresh.value, nonce: fresh.nonce });
    window.dispatchEvent(new Event('fxaeon:activity-updated'));
    if (current()) { setHash(result.hash); void assets.refresh(); }
    } });
  });
  if (hash && quote) return <section className={`${styles.card} ${styles.done}`} aria-label="Send submitted">
    <span className={styles.doneMark} aria-hidden="true"><Clock3 /></span>
    <h2>Submitted</h2>
    <p className={styles.doneAmount}><strong title={`${quote.input.amount} ${quote.symbol}`}>{formatSignificantDecimal(quote.input.amount, 8)} {quote.symbol}</strong> to {shortAddress(quote.input.recipient)}</p>
    <p className={styles.doneNote}>Not confirmed by the network yet. History shows its status.</p>
    <Link className={`button button-primary ${styles.action}`} href="/history">View history</Link>
    <a className={`button button-ghost ${styles.action}`} href={`https://${quote.input.chainId === 1 ? 'etherscan.io' : 'basescan.org'}/tx/${hash}`} target="_blank" rel="noopener noreferrer">View transaction<ArrowUpRight aria-hidden="true" /></a>
  </section>;
  return <section className={styles.card} aria-label={quote ? 'Review send' : 'Send crypto'}>
    {quote ? <>
      <header className={styles.reviewHeader}>
        <button type="button" className={styles.back} aria-label="Edit transfer" disabled={busy} onClick={() => { setQuote(null); setError(''); }}><ArrowLeft aria-hidden="true" /></button>
        <h2>Review send</h2>
      </header>
      <div className={styles.reviewHero}>
        <TokenIcon symbol={quote.symbol} size={48} />
        <p className={styles.reviewAmount} title={`${quote.input.amount} ${quote.symbol}`}>{formatSignificantDecimal(quote.input.amount, 8)} <span>{quote.symbol}</span></p>
      </div>
      <div className={styles.recipientReview}>
        <span className={styles.fieldLabel}>To</span>
        <div className={styles.recipientIdentity}>
          <WalletAvatar address={quote.input.recipient} size={32} />
          <GroupedAddress address={quote.input.recipient} />
        </div>
      </div>
      <dl className={styles.facts}>
        <div><dt>Network</dt><dd><ChainIcon chainId={quote.input.chainId} size={18} />{networkName(quote.input.chainId)}</dd></div>
        <div><dt>Network cost</dt><dd>≈ {formatEther(quote.estimatedFee)} ETH</dd></div>
      </dl>
    </> : <>
      <div className={styles.amountPanel}>
        <div className={styles.panelHead}>
          <label htmlFor="send-amount">Amount</label>
          <button type="button" className={styles.max} disabled={busy || !asset} onClick={maximum}><span>Max</span></button>
        </div>
        <div className={styles.amountRow}>
          <span className={styles.amountFit}><input id="send-amount" className={styles.amountInput} style={{ '--amount-length': Math.max(trimmedAmount.length, 1) } as CSSProperties} inputMode="decimal" autoComplete="off" placeholder="0" value={amount} disabled={busy} aria-invalid={Boolean(amountProblem) || undefined} onChange={(event) => { setAmount(event.target.value); setError(''); }} /></span>
          <WalletAssetPicker label="Asset to send" assets={tokens} value={asset} disabled={busy} loading={assets.status === 'loading' || assets.status === 'idle'} onChange={(next) => { setAssetId(next.id); setAmount(''); setError(''); }} />
        </div>
        {amountProblem && trimmedAmount !== '.' ? <p className={styles.hint}>{amountProblem}</p>
          : asset && <p className={styles.balance}>Balance <span title={`${asset.balance} ${symbol}`}>{formatSignificantDecimal(asset.balance)} {symbol}</span>{asset.usdValue !== null && <span className={styles.balanceUsd}>{formatUsd(asset.usdValue)}</span>}</p>}
      </div>
      <div className={styles.recipientPanel}>
        <label htmlFor="send-recipient" className={styles.fieldLabel}>To</label>
        <div className={styles.recipientRow}>
          {recipientValid ? <WalletAvatar address={trimmedRecipient} size={28} /> : <span className={styles.recipientEmpty} aria-hidden="true"><Wallet /></span>}
          {/* Two lines show the whole address while it is entered; Enter never adds a line break. */}
          <textarea id="send-recipient" rows={2} aria-label="Recipient address" aria-invalid={trimmedRecipient !== '' && !recipientValid} aria-describedby={trimmedRecipient && !recipientValid ? recipientHintId : undefined} placeholder="0x… wallet address" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={recipient} disabled={busy} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} onChange={(event) => { setRecipient(event.target.value); setError(''); }} />
        </div>
        {trimmedRecipient && !recipientValid && <p id={recipientHintId} className={styles.hint}>Enter a complete 0x wallet address.</p>}
      </div>
      {wallet.isEmbedded && <div className={styles.speed}>
        <span id={speedLabelId} className={styles.fieldLabel}>Network speed</span>
        <div className={styles.tiers} role="group" aria-labelledby={speedLabelId} style={{ '--seg-index': GAS_TIERS.indexOf(tier), '--seg-count': GAS_TIERS.length } as CSSProperties}>
          {GAS_TIERS.map((option) => <button key={option} type="button" aria-pressed={tier === option} disabled={busy} onClick={() => setTier(option)}>{option}</button>)}
        </div>
      </div>}
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="button" className={`button button-primary ${styles.action}`} aria-busy={busy || undefined} disabled={busy || !quote && blocker !== null} onClick={quote ? confirm : review}>{busy ? quote ? 'Confirm in wallet' : 'Preparing' : quote ? 'Confirm' : blocker ?? <>Review<ChevronRight aria-hidden="true" /></>}</button>
  </section>;
}
