'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, TokenSelect } from '@/components/ProtocolForm';
import { useMoveBalances } from '@/components/WalletDataProvider';
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
import { ChainIcon } from '@/components/TokenIcon';
import styles from '@/components/FlowWorkspace.module.css';

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
  const [customRecipient, setCustomRecipient] = useState(false);
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
  const recipientValue = customRecipient ? recipientInput.trim() : wallet.address || '';

  const balanceQuery = useMoveBalances({ address: wallet.address, chainId: sourceChainId, enabled: !advanced });
  const moveBalances = !advanced ? balanceQuery.data?.balances : undefined;
  const moveBalanceStatusForPicker = !advanced && wallet.address
    ? (balanceQuery.status === 'idle' ? 'loading' : balanceQuery.status)
    : undefined;
  const moveBalanceState = moveBalances?.[token]
    ?? (moveBalanceStatusForPicker ? { status: moveBalanceStatusForPicker } : undefined);

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
    <AppShell title="Move" subtitle="Move assets between Ethereum and Base.">
      <div className={styles.workspace}>
        {!wallet.address && (
          <WalletConnectCTA
            ready={wallet.ready}
            authenticated={wallet.authenticated}
            body="Connect the wallet that will sign the move and pay the source-network fee."
          />
        )}

        <Card className={`${styles.focusCard} p-5`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={styles.eyebrow}>Cross-chain transfer</p>
              <h2 className="mt-1 text-[22px] font-semibold tracking-[-.03em]">Bridge</h2>
              <p className={`mt-0.5 ${styles.supportCopy}`}>{sourceName} to {destinationName}</p>
            </div>
            <span className="rounded-lg bg-[var(--mint-dim)] px-2.5 py-1 text-[11px] font-semibold text-mint">
              {advanced ? 'Advanced OFT' : token}
            </span>
          </div>

          <div className={`mt-5 ${styles.networkFlow}`}>
            <NetworkField label="From" name={sourceName} chainId={sourceChainId} />
            <button
              type="button"
              aria-label={`Reverse route to ${sourceName}`}
              onClick={() => setDirection((current) => current === 'ethereum_to_base' ? 'base_to_ethereum' : 'ethereum_to_base')}
              className={`glass-press ${styles.networkArrow}`}
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <NetworkField label="To" name={destinationName} chainId={destinationChainId} />
          </div>

          <div className="my-4 hairline" />
          <div className="flex flex-col gap-4">
            {!advanced && (
              <TokenSelect label="Asset" value={token} options={['fxUSD', 'fxSAVE'] as const} onChange={setToken} balances={moveBalances} balanceStatus={wallet.address ? moveBalanceStatusForPicker : 'disconnected'} />
            )}

            <details
              open={advanced}
              onToggle={(event) => setMode(event.currentTarget.open ? 'advanced' : 'canonical')}
              className={styles.advancedPanel}
            >
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-[12px] font-semibold text-mut">
                <span>Advanced OFT</span>
                <span className="text-[11px] font-normal text-[var(--mut-2)]">Custom contracts</span>
              </summary>
              <div className="border-t border-[var(--line)] p-3">
                <AdvancedAddressFields
                  sourceName={sourceName}
                  destinationName={destinationName}
                  sourceChainId={sourceChainId}
                  sourceOft={sourceOft}
                  destinationOft={destinationOft}
                  approvalToken={approvalToken}
                  onSourceOftChange={setSourceOft}
                  onDestinationOftChange={setDestinationOft}
                  onApprovalTokenChange={setApprovalToken}
                />
                <AdvancedRiskSummary sourceName={sourceName} destinationName={destinationName} />
              </div>
            </details>

            <div className={styles.amountHero}>
              <AmountField
                label="Amount"
                hint={`From ${sourceName}`}
                symbol={advanced ? 'OFT' : token}
                value={amount}
                onChange={setAmount}
                maxDecimals={18}
                balanceState={moveBalanceState}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[12px] font-medium text-mut">Recipient</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !customRecipient;
                    setCustomRecipient(next);
                    if (next && !recipientInput && wallet.address) setRecipientInput(wallet.address);
                  }}
                  className="min-h-11 rounded-lg px-2 text-[11px] font-semibold text-mint"
                >
                  {customRecipient ? 'Use connected wallet' : 'Change'}
                </button>
              </div>
              {customRecipient ? (
                <AddressField
                  label="Destination wallet"
                  value={recipientInput}
                  onChange={setRecipientInput}
                  placeholder="0x… destination wallet"
                />
              ) : (
                <div className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--input)] px-3">
                  <span className="text-[12px] text-mut">{wallet.address ? 'Connected wallet' : 'Recipient wallet'}</span>
                  {wallet.address ? (
                    <span className="font-mono text-[12px] font-semibold">
                      {`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`}
                    </span>
                  ) : (
                    <ConnectWalletButton
                      aria-label="Connect wallet for recipient"
                      className="glass-press min-h-11 rounded-xl px-3 text-[12px] font-semibold text-mint"
                    >
                      Connect wallet
                    </ConnectWalletButton>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>

        <ActionReview
          planBuilder={planBuilder}
          label={`Review move to ${destinationName}`}
          operationLabel={`Move ${advanced ? 'advanced OFT' : token} to ${destinationName}`}
          onComplete={async () => {
            try {
              await rereadBridgeState();
            } finally {
              await balanceQuery.refresh();
            }
          }}
        />
      </div>
    </AppShell>
  );
}

function AdvancedAddressFields({ sourceName, destinationName, sourceChainId, sourceOft, destinationOft, approvalToken, onSourceOftChange, onDestinationOftChange, onApprovalTokenChange }: { sourceName: string; destinationName: string; sourceChainId: FxChainId; sourceOft: string; destinationOft: string; approvalToken: string; onSourceOftChange: (value: string) => void; onDestinationOftChange: (value: string) => void; onApprovalTokenChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <AddressField label={`${sourceName} OFT`} value={sourceOft} onChange={onSourceOftChange} placeholder="0x… checksummed address" />
      <AddressField label={`${destinationName} OFT`} value={destinationOft} onChange={onDestinationOftChange} placeholder="0x… checksummed address" />
      {sourceChainId === 1 && (
        <AddressField
          label="Ethereum approval token"
          hint="Only when required"
          value={approvalToken}
          onChange={onApprovalTokenChange}
          placeholder="0x… checksummed address"
        />
      )}
    </div>
  );
}

function AdvancedRiskSummary({ sourceName, destinationName }: { sourceName: string; destinationName: string }) {
  return (
    <div className="mt-3 rounded-xl border border-[rgba(255,194,102,.28)] bg-[var(--warn-dim)] p-3 text-[11.5px] leading-relaxed text-warn">
      <div className="flex gap-2.5">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p><span className="font-semibold">Custom contract risk.</span> Only continue if you trust both OFT addresses for {sourceName} and {destinationName}.</p>
      </div>
      <details className="mt-2 border-t border-[rgba(255,194,102,.18)] pt-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-[11px] font-semibold">Validation checks</summary>
        <ul className="space-y-1 pb-1 pl-4 text-mut">
          <li>Checksummed, deployed 18-decimal contracts</li>
          <li>Matching LayerZero peers and live quotes in both directions</li>
          <li>Exact bridge target and approval token when required</li>
        </ul>
      </details>
    </div>
  );
}

function AddressField({ label, hint, value, onChange, placeholder }: { label: string; hint?: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3 text-[12px] font-medium text-mut">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-[var(--mut-2)]">{hint}</span>}
      </span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} inputMode="text" className="min-h-[56px] w-full rounded-2xl border border-[var(--line)] bg-[var(--input)] px-3 font-mono text-[16px] outline-none focus:border-mint" />
    </label>
  );
}

function NetworkField({ label, name, chainId }: { label: 'From' | 'To'; name: string; chainId: FxChainId }) {
  return (
    <div className={styles.networkNode}>
      <span className="block text-[11px] text-mut">{label}</span>
      <span className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold"><ChainIcon chainId={chainId} size={18} />{name}</span>
    </div>
  );
}
