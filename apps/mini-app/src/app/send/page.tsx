'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatEther, formatUnits, isAddress, type Address } from 'viem';
import { ArrowLeft, ArrowUpRight, Clock3, ChevronRight } from 'lucide-react';
import { AppShell } from '@/components/ui';
import TokenIcon, { ChainIcon } from '@/components/TokenIcon';
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
import styles from './send.module.css';
const SEND_DEMAND = { expandedAssets: true, chainPulse: true, positions: false } as const;

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
  const mounted = useRef(true);
  const identity = `${wallet.address?.toLowerCase()}:${wallet.connectionVersion}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && currentIdentity.current === identity;
  const input = (value = amount): SendInput => {
    if (!asset || !wallet.address || !isAddress(recipient.trim())) throw new Error('Enter a valid recipient address.');
    return { walletAddress: wallet.address as Address, recipient: recipient.trim() as Address, chainId: asset.chainId, tokenAddress: asset.tokenAddress,
      amount: value, tier: wallet.isEmbedded ? tier : 'standard' };
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); } catch (cause) { if (current()) setError(userSafeError(cause, 'Transfer could not be prepared. Try again.')); }
    finally { lock.current = false; if (current()) setBusy(false); }
  };
  const maximum = () => void run(async () => {
    if (!asset) return;
    if (asset.tokenAddress) { setAmount(asset.balance); return; }
    const estimate = await prepareWalletSend(input('0.000000000000000001'));
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
  if (hash && quote) return <section className={styles.card}>
    <Clock3 size={32} className={styles.sentIcon} /><h2>Submitted</h2><p className={styles.subtitle}>{quote.input.amount} {quote.symbol}</p>
    <a className={styles.secondary} href={`https://${quote.input.chainId === 1 ? 'etherscan.io' : 'basescan.org'}/tx/${hash}`} target="_blank" rel="noopener noreferrer">View transaction<ArrowUpRight size={18} /></a>
    <Link className={styles.primary} href="/history">View history</Link>
  </section>;
  return <section className={styles.card} aria-label={quote ? 'Review send' : 'Send crypto'}>
    <header>{quote ? <button type="button" aria-label="Edit transfer" disabled={busy} onClick={() => { setQuote(null); setError(''); }}><ArrowLeft size={20} /></button> : <ArrowUpRight size={24} />}<h2>{quote ? 'Review send' : 'Send crypto'}</h2></header>
    {quote ? <>
      <div className={styles.reviewAmount}><TokenIcon symbol={quote.symbol} size={48} /><strong>{quote.input.amount} {quote.symbol}</strong></div>
      <div className={styles.recipient}><WalletAvatar address={quote.input.recipient} /><span><small>To</small><strong>{quote.input.recipient}</strong></span></div>
      <dl className={styles.facts}><div><dt>Network</dt><dd><ChainIcon chainId={quote.input.chainId} size={18} />{quote.input.chainId === 1 ? 'Ethereum' : 'Base'}</dd></div><div><dt>Network cost</dt><dd>≈ {formatEther(quote.estimatedFee)} ETH</dd></div></dl>
    </> : <>
      <div className={styles.amountBox}>
        <label htmlFor="send-amount">Amount</label><input id="send-amount" inputMode="decimal" autoComplete="off" placeholder="0" value={amount} disabled={busy} onChange={(event) => { setAmount(event.target.value); setError(''); }} />
        <div className={styles.tokenRow}>{asset && <TokenIcon symbol={asset.symbol} size={28} />}<select aria-label="Asset to send" disabled={busy || !tokens.length} value={asset?.id ?? ''} onChange={(event) => { setAssetId(event.target.value); setAmount(''); setError(''); }}>
          {!tokens.length && <option value="">{assets.status === 'loading' || assets.status === 'idle' ? 'Loading assets' : 'No available assets'}</option>}
          {tokens.map((token) => <option key={token.id} value={token.id}>{token.symbol} · {token.chainId === 1 ? 'Ethereum' : 'Base'}</option>)}
        </select><button type="button" disabled={busy || !asset || !asset.tokenAddress && !isAddress(recipient.trim())} onClick={maximum}>Max</button></div>
        {asset && <p className={styles.balance}>Balance: {asset.balance} {asset.symbol}</p>}
      </div>
      <label className={styles.to}>To<input aria-label="Recipient address" placeholder="Wallet address" autoComplete="off" spellCheck={false} value={recipient} disabled={busy} onChange={(event) => { setRecipient(event.target.value); setError(''); }} /></label>
      {wallet.isEmbedded && <div className={styles.tiers} role="group" aria-label="Network speed">{GAS_TIERS.map((option) => <button key={option} type="button" aria-pressed={tier === option} disabled={busy} onClick={() => setTier(option)}>{option}</button>)}</div>}
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="button" className={styles.primary} disabled={busy || !quote && (!asset || !amount || !isAddress(recipient.trim()))} onClick={quote ? confirm : review}>{busy ? quote ? 'Confirm in wallet' : 'Preparing' : quote ? 'Confirm' : <>Review<ChevronRight size={18} /></>}</button>
  </section>;
}
