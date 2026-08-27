'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Network, Route } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, InfoNote, Segmented, TokenSelect } from '@/components/ProtocolForm';
import {
  advancedBridgePolicy,
  assertAddress,
  assertBridgeActionTarget,
  assertChecksummedAddress,
  assertPublicClientChain,
  bridgeDeliveryLowerBound,
  getBridgeApprovalAllowance,
  getFxSdk,
  getPublicClient,
  planBridgeRoute,
  resolveBridgeApprovalTokenAddress,
  resolveBridgeTokenAddress,
  requireRpcUrl,
  validateAdvancedBridgeContracts,
  type FxChainId,
} from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { parseAmount } from '@/app/trade/fxUi';

const ERC20_BALANCE_ABI = [{
  type: 'function',
  name: 'balanceOf',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

type Direction = 'ethereum_to_base' | 'base_to_ethereum';
type BridgeAsset = 'fxUSD' | 'fxSAVE';
type BridgeMode = 'canonical' | 'advanced';

export default function MovePage() {
  const wallet = usePrivyWallet();
  const [direction, setDirection] = useState<Direction>('ethereum_to_base');
  const [mode, setMode] = useState<BridgeMode>('canonical');
  const [token, setToken] = useState<BridgeAsset>('fxUSD');
  const [amount, setAmount] = useState('');
  const [sourceOft, setSourceOft] = useState('');
  const [destinationOft, setDestinationOft] = useState('');
  const [approvalToken, setApprovalToken] = useState('');
  const [recipientInput, setRecipientInput] = useState('');
  const reviewedBridgeRef = useRef<{
    sourceChainId: FxChainId;
    destinationChainId: FxChainId;
    sourceTokenAddress: `0x${string}`;
    destinationTokenAddress: `0x${string}`;
    approvalTokenAddress?: `0x${string}`;
    spender: `0x${string}`;
    recipient: `0x${string}`;
  } | null>(null);

  const sourceChainId: FxChainId = direction === 'ethereum_to_base' ? 1 : 8453;
  const destinationChainId: FxChainId = direction === 'ethereum_to_base' ? 8453 : 1;
  const sourceName = sourceChainId === 1 ? 'Ethereum' : 'Base';
  const destinationName = destinationChainId === 1 ? 'Ethereum' : 'Base';
  // Canonical bridge assets and advanced OFTs are all constrained to the
  // SDK's 18-decimal amount model.
  const amountWei = parseAmount(amount, 'fxUSD');
  const advanced = mode === 'advanced';
  const recipientValue = recipientInput.trim() || wallet.address || '';

  const planBuilder = useMemo(() => {
    if (!wallet.address || !amountWei) return null;
    return async () => {
      const signer = assertAddress(wallet.address!, 'selected wallet');
      const recipient = assertAddress(recipientValue, 'bridge recipient');
      const lowerBound = bridgeDeliveryLowerBound(amountWei);
      await Promise.all([
        assertPublicClientChain(getPublicClient(sourceChainId), sourceChainId),
        assertPublicClientChain(getPublicClient(destinationChainId), destinationChainId),
      ]);
      const sdk = getFxSdk();
      let sourceToken: string = token;
      let sourceOftAddress: `0x${string}`;
      let sourceTokenAddress: `0x${string}`;
      let destinationTokenAddress: `0x${string}`;
      let destinationOftAddress: `0x${string}`;
      let destinationOftForQuote = destinationOft;
      let approvalTokenAddress: `0x${string}` | undefined;
      let sourceApprovalRequired = sourceChainId === 1;
      let destinationApprovalRequired = false;
      let customPolicy: ReturnType<typeof advancedBridgePolicy> | undefined;

      if (advanced) {
        // Do not silently normalize an advanced address. Requiring EIP-55
        // casing makes the reviewed contract identity visible and copy-safe.
        const reviewedSourceOft = assertChecksummedAddress(sourceOft, 'source OFT');
        const reviewedDestinationOft = assertChecksummedAddress(destinationOft, 'destination OFT');
        const reviewedApprovalToken = approvalToken.trim()
          ? assertChecksummedAddress(approvalToken, 'Ethereum underlying approval token')
          : undefined;
        const metadata = await validateAdvancedBridgeContracts({
          sourceClient: getPublicClient(sourceChainId),
          destinationClient: getPublicClient(destinationChainId),
          sourceOftAddress: reviewedSourceOft,
          destinationOftAddress: reviewedDestinationOft,
          ethereumApprovalTokenAddress: reviewedApprovalToken,
          sourceChainId,
          destinationChainId,
        });
        sourceToken = reviewedSourceOft;
        destinationOftForQuote = reviewedDestinationOft;
        sourceOftAddress = reviewedSourceOft;
        sourceTokenAddress = metadata.sourceTokenAddress;
        destinationTokenAddress = metadata.destinationTokenAddress;
        destinationOftAddress = reviewedDestinationOft;
        sourceApprovalRequired = metadata.sourceApprovalRequired;
        destinationApprovalRequired = metadata.destinationApprovalRequired;
        approvalTokenAddress = metadata.sourceApprovalRequired ? reviewedApprovalToken : undefined;
        customPolicy = advancedBridgePolicy({
          walletAddress: signer,
          chainId: sourceChainId,
          sourceOftAddress: reviewedSourceOft,
          ethereumApprovalTokenAddress: approvalTokenAddress,
          approvalRequired: metadata.sourceApprovalRequired,
        });
      } else {
        sourceOftAddress = resolveBridgeTokenAddress(token, sourceChainId);
        sourceTokenAddress = sourceChainId === 1 ? resolveBridgeApprovalTokenAddress(token, sourceChainId) : sourceOftAddress;
        destinationOftAddress = resolveBridgeTokenAddress(token, destinationChainId);
        destinationTokenAddress = destinationChainId === 1
          ? resolveBridgeApprovalTokenAddress(token, destinationChainId)
          : destinationOftAddress;
        approvalTokenAddress = sourceChainId === 1 ? resolveBridgeApprovalTokenAddress(token, sourceChainId) : undefined;
      }

      // Capture a destination-chain block before the source route can reach a
      // wallet prompt. Delivery is later correlated by LayerZero GUID and
      // OFTReceived logs from this block onward; a balance delta is never used
      // as proof.
      const destinationBaselineBlock = await getPublicClient(destinationChainId).getBlockNumber();

      // getBridgeQuote is an explicit official SDK capability. For advanced
      // OFTs it also probes quoteSend on the reviewed source contract.
      const quote = await sdk.getBridgeQuote({ sourceChainId, destChainId: destinationChainId, token: sourceToken, amount: amountWei, recipient, sourceRpcUrl: requireRpcUrl(sourceChainId) });
      if (advanced) {
        // Probe the reviewed destination OFT in the reverse direction too;
        // this is the only public SDK/RPC proof available that its quoteSend
        // surface is callable on the destination contract.
        await sdk.getBridgeQuote({ sourceChainId: destinationChainId, destChainId: sourceChainId, token: destinationOftForQuote, amount: amountWei, recipient, sourceRpcUrl: requireRpcUrl(destinationChainId) });
      }
      // Build once without an approval so the exact SDK bridge destination is
      // known, then read the allowance for that exact spender. The final route
      // adds one exact approval only when it is still needed.
      const unapproved = await planBridgeRoute({ sourceChainId, destChainId: destinationChainId, token: sourceToken, amount: amountWei, recipient, refundAddress: signer, walletAddress: signer, sourceRpcUrl: requireRpcUrl(sourceChainId), includeApproval: false, destinationOftAddress, destinationBaselineBlock });
      const reviewedSourceOft = assertBridgeActionTarget(unapproved, sourceOftAddress);
      const approvalAllowance = sourceChainId === 1 && sourceApprovalRequired
        ? await getBridgeApprovalAllowance({ client: getPublicClient(sourceChainId), tokenAddress: approvalTokenAddress!, owner: signer, spender: reviewedSourceOft.to })
        : undefined;
      const route = await planBridgeRoute({ sourceChainId, destChainId: destinationChainId, token: sourceToken, amount: amountWei, recipient, refundAddress: signer, walletAddress: signer, sourceRpcUrl: requireRpcUrl(sourceChainId), includeApproval: advanced ? sourceApprovalRequired : true, approvalAllowance, approvalTokenAddress, destinationOftAddress, destinationBaselineBlock });
      assertBridgeActionTarget(route, reviewedSourceOft.to);
      reviewedBridgeRef.current = {
        sourceChainId,
        destinationChainId,
        sourceTokenAddress,
        destinationTokenAddress,
        approvalTokenAddress,
        spender: reviewedSourceOft.to,
        recipient,
      };
      return {
        ...route,
        policy: customPolicy ? { ...customPolicy, maxValueWei: (route.quote as { nativeFee: bigint }).nativeFee } : undefined,
        quote: {
          ...(route.quote as { nativeFee: bigint; lzTokenFee: bigint }),
          requestedQuote: quote,
          bridgeToken: advanced ? 'Advanced OFT' : token,
          bridgeAmount: amountWei,
          deliveryLowerBound: lowerBound,
          sourceOftAddress: reviewedSourceOft.to,
          destinationOftAddress,
          sourceTokenAddress,
          sourceApprovalRequired,
          destinationApprovalRequired,
          approvalTokenAddress,
          destinationTokenAddress,
          destinationBaselineBlock,
          recipient,
        },
      };
    };
  }, [advanced, amountWei, approvalToken, destinationChainId, destinationOft, recipientValue, sourceChainId, sourceOft, token, wallet.address]);

  const rereadBridgeState = useCallback(async () => {
    const reviewed = reviewedBridgeRef.current;
    if (!reviewed || !wallet.address) return;
    const sourceClient = getPublicClient(reviewed.sourceChainId);
    const destinationClient = getPublicClient(reviewed.destinationChainId);
    const sourceBalanceAddress = reviewed.approvalTokenAddress ?? reviewed.sourceTokenAddress;
    const reads: Promise<unknown>[] = [
      sourceClient.readContract({ address: sourceBalanceAddress, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [wallet.address as `0x${string}`] }),
      destinationClient.readContract({ address: reviewed.destinationTokenAddress, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [reviewed.recipient] }),
    ];
    if (reviewed.approvalTokenAddress) {
      reads.push(getBridgeApprovalAllowance({ client: sourceClient, tokenAddress: reviewed.approvalTokenAddress, owner: wallet.address as `0x${string}`, spender: reviewed.spender }));
    }
    await Promise.all(reads);
  }, [wallet.address]);

  return (
    <AppShell title="Move" subtitle="Bridge canonical assets—or validate an explicit 18-decimal OFT contract pair—between Ethereum and Base.">
      <div className="stagger flex flex-col gap-3.5">
        <Card glow className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">Cross-chain gateway</p><h2 className="text-display mt-2 text-[25px] font-semibold">Ethereum ↔ Base</h2><p className="mt-1 text-[11px] leading-relaxed text-mut">Choose the destination recipient. A source receipt alone is never treated as delivery.</p></div><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><Network className="h-5 w-5" /></span></div><div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2"><ChainCard name={sourceName} chainId={sourceChainId} /><span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--bg)] text-mint"><ArrowLeftRight className="h-4 w-4" /></span><ChainCard name={destinationName} chainId={destinationChainId} /></div></Card>
        {!wallet.address && <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Choose the signing wallet that pays source-chain gas and receives any fee refund. You may enter a separate validated destination recipient below." />}
        <Segmented value={direction} onChange={setDirection} ariaLabel="Bridge direction" options={[{ value: 'ethereum_to_base', label: 'To Base', sub: 'Ethereum → Base' }, { value: 'base_to_ethereum', label: 'To Ethereum', sub: 'Base → Ethereum' }]} />
        <Segmented value={mode} onChange={setMode} ariaLabel="Bridge asset mode" options={[{ value: 'canonical', label: 'Canonical assets', sub: 'fxUSD / fxSAVE' }, { value: 'advanced', label: 'Advanced OFT', sub: 'Explicit contract review' }]} />
        <Card className="p-4"><div className="flex flex-col gap-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Route className="h-5 w-5" /></span><div><h2 className="text-[14px] font-semibold">Bridge {sourceName} → {destinationName}</h2><p className="mt-0.5 text-[10.5px] text-mut">LayerZero V2 quote and SDK transaction plan.</p></div></div>{!advanced ? <TokenSelect label="Asset" value={token} options={['fxUSD', 'fxSAVE'] as const} onChange={setToken} /> : <AdvancedAddressFields sourceName={sourceName} destinationName={destinationName} sourceChainId={sourceChainId} sourceOft={sourceOft} destinationOft={destinationOft} approvalToken={approvalToken} onSourceOftChange={setSourceOft} onDestinationOftChange={setDestinationOft} onApprovalTokenChange={setApprovalToken} /> }<AmountField label={`Amount on ${sourceName}`} symbol={advanced ? 'OFT' : token} value={amount} onChange={setAmount} maxDecimals={18} /><AddressField label={`${destinationName} recipient`} value={recipientValue} onChange={setRecipientInput} placeholder="0x… destination wallet" /><div className="rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,.025)] p-3.5"><Row label="Source chain" value={`${sourceName} (${sourceChainId})`} /><Row label="Destination chain" value={`${destinationName} (${destinationChainId})`} /><Row label="Signer / fee refund" value={wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : 'Connect wallet'} /><Row label="Recipient" value={recipientValue ? `${recipientValue.slice(0, 6)}…${recipientValue.slice(-4)}` : 'Enter address'} /></div>{advanced ? <AdvancedRiskSummary sourceName={sourceName} destinationName={destinationName} sourceOft={sourceOft} destinationOft={destinationOft} approvalToken={approvalToken} /> : <InfoNote>Ethereum-source routes include an exact token approval when needed. Base routes use one bridge transaction. Every step is shown and signed separately.</InfoNote>}</div></Card>
        <ActionReview planBuilder={planBuilder} label={`Review bridge to ${destinationName}`} operationLabel={`${advanced ? 'Advanced OFT' : token} · ${sourceName} to ${destinationName}`} onComplete={rereadBridgeState} />
      </div>
    </AppShell>
  );
}

function AdvancedAddressFields({ sourceName, destinationName, sourceChainId, sourceOft, destinationOft, approvalToken, onSourceOftChange, onDestinationOftChange, onApprovalTokenChange }: { sourceName: string; destinationName: string; sourceChainId: FxChainId; sourceOft: string; destinationOft: string; approvalToken: string; onSourceOftChange: (value: string) => void; onDestinationOftChange: (value: string) => void; onApprovalTokenChange: (value: string) => void }) {
  return <div className="flex flex-col gap-3"><AddressField label={`${sourceName} source OFT`} value={sourceOft} onChange={onSourceOftChange} placeholder="0x… (EIP-55 checksum)" /><AddressField label={`${destinationName} destination OFT`} value={destinationOft} onChange={onDestinationOftChange} placeholder="0x… (EIP-55 checksum)" />{sourceChainId === 1 && <AddressField label="Ethereum approval token (only if source adapter requires it)" value={approvalToken} onChange={onApprovalTokenChange} placeholder="0x… (EIP-55 checksum)" />}<InfoNote>FxAeon checksummed-validates both OFT contracts, reads each OFT's token() local-token address and approvalRequired(), requires deployed local tokens with decimals() = 18, probes quoteSend in both directions through the official SDK, verifies the symmetric LayerZero peers, and binds the send target to the reviewed source OFT. The destination field must be the destination OFT contract, never its underlying token(). A direct OFT must leave approval blank.</InfoNote></div>;
}

function AdvancedRiskSummary({ sourceName, destinationName, sourceOft, destinationOft, approvalToken }: { sourceName: string; destinationName: string; sourceOft: string; destinationOft: string; approvalToken: string }) {
  return <div className="flex gap-2.5 rounded-2xl border border-[rgba(255,194,102,.28)] bg-[rgba(255,194,102,.08)] p-3 text-[11px] leading-relaxed text-warn"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">Advanced bridge risk review</p><p className="mt-1">You are reviewing custom contracts, not FxAeon’s canonical asset list. Enter the source and destination OFT contracts only. FxAeon will read each OFT’s local token() and approvalRequired() metadata, verify both LayerZero peers, and accept an Ethereum token() address only when the source adapter requires an exact approval. The detected local tokens are shown in the immutable transaction review; they are not taken from editable form state. {sourceName} → {destinationName} calldata is shown again before each wallet approval.</p><p className="mt-1 break-all font-mono text-[9px]">Source OFT: {sourceOft || 'required'} · Destination OFT: {destinationOft || 'required'}{sourceName === 'Ethereum' ? ` · Approval input: ${approvalToken || 'blank unless required'}` : ''}</p></div></div>;
}

function AddressField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.13em] text-mut">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} inputMode="text" className="min-h-12 w-full rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,.035)] px-3 font-mono text-[11px] outline-none focus:border-[rgba(139,109,255,.5)]" /></label>;
}

function ChainCard({ name, chainId }: { name: string; chainId: number }) { return <div className="rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,.035)] p-3"><span className="block text-[9px] uppercase tracking-[0.13em] text-mut">Network</span><span className="mt-1 block text-[13px] font-semibold">{name}</span><span className="mt-0.5 block text-[10px] text-mut">Chain {chainId}</span></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 py-1 text-[11px]"><span className="text-mut">{label}</span><span className="text-right font-semibold">{value}</span></div>; }
