'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { Address } from 'viem';
import { AppShell, Card } from '@/components/ui';
import { ActionReview, type ActionReviewStage } from '@/components/ActionReview';
import { AmountField, TokenSelect } from '@/components/ProtocolForm';
import { useMoveBalances } from '@/components/WalletDataProvider';
import {
  assertAddress,
  assertBridgeActionTarget,
  assertPublicClientChain,
  bridgeDeliveryLowerBound,
  getBridgeApprovalAllowance,
  getFxReadFacade,
  withReadDeadline,
  getPublicClient,
  planBridgeRoute,
  resolveBridgeApprovalTokenAddress,
  resolveBridgeTokenAddress,
  requireRpcUrl,
  restoreSignatureRequiredDraftFromSearch,
  type FxChainId,
} from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { parseAmount } from '@/app/trade/fxUi';
import { resetTransactionAmounts } from '@/lib/transactionState';
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
// Kept in draft compatibility so old signature-required links remain safe;
// the user-facing bridge is intentionally canonical-only.
type BridgeMode = 'canonical' | 'advanced';

const MOVE_DRAFT_ACTION_KEYS = {
  ethereum_to_base: {
    canonical: { fxUSD: 'move:ethereum_to_base:canonical:fxUSD', fxSAVE: 'move:ethereum_to_base:canonical:fxSAVE' },
    advanced: { fxUSD: 'move:ethereum_to_base:advanced:fxUSD', fxSAVE: 'move:ethereum_to_base:advanced:fxSAVE' },
  },
  base_to_ethereum: {
    canonical: { fxUSD: 'move:base_to_ethereum:canonical:fxUSD', fxSAVE: 'move:base_to_ethereum:canonical:fxSAVE' },
    advanced: { fxUSD: 'move:base_to_ethereum:advanced:fxUSD', fxSAVE: 'move:base_to_ethereum:advanced:fxSAVE' },
  },
} as const;

type MoveDraftState = {
  direction: Direction;
  mode: BridgeMode;
  token: BridgeAsset;
  amount: string;
  sourceOft: string;
  destinationOft: string;
  approvalToken: string;
  recipientInput: string;
  customRecipient: boolean;
};

const MOVE_DRAFT_CANDIDATES: readonly MoveDraftState[] = (Object.keys(MOVE_DRAFT_ACTION_KEYS) as Direction[]).flatMap((direction) => (
  (Object.keys(MOVE_DRAFT_ACTION_KEYS[direction]) as BridgeMode[]).flatMap((mode) => (
    (Object.keys(MOVE_DRAFT_ACTION_KEYS[direction][mode]) as BridgeAsset[]).map((token) => ({
      direction,
      mode,
      token,
      amount: '',
      sourceOft: '',
      destinationOft: '',
      approvalToken: '',
      recipientInput: '',
      customRecipient: false,
    }))
  ))
));

function moveDraftActionKey(direction: Direction, mode: BridgeMode, token: BridgeAsset): string {
  return MOVE_DRAFT_ACTION_KEYS[direction][mode][token];
}

function draftString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length <= 512 ? value : fallback;
}

function draftEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : fallback;
}

function draftBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export default function MovePage() {
  const wallet = usePrivyWallet();
  const [direction, setDirection] = useState<Direction>('ethereum_to_base');
  const [token, setToken] = useState<BridgeAsset>('fxUSD');
  const [amount, setAmount] = useState('');
  const [recipientInput, setRecipientInput] = useState('');
  const [customRecipient, setCustomRecipient] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [resumeReview, setResumeReview] = useState(0);
  const [reviewStage, setReviewStage] = useState<ActionReviewStage>('input');
  const previousWalletContextRef = useRef<string | null>(null);
  // A review-rail connection is part of the current move action. Do not
  // clear its amount/recipient while the first wallet is hydrating; changes
  // after a wallet is selected still invalidate the wallet-scoped form.
  const lastConnectedWalletRef = useRef<string | null>(null);
  const lastConnectedChainRef = useRef<number | undefined>(undefined);
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
  const amountWei = parseAmount(amount, 'fxUSD');
  const recipientValue = customRecipient ? recipientInput.trim() : wallet.address || '';
  const mode: BridgeMode = 'canonical';
  const draftState = useMemo(() => ({
    direction,
    mode,
    token,
    amount,
    recipientInput,
    customRecipient,
  }), [amount, customRecipient, direction, mode, recipientInput, token]);
  const draftActionKey = moveDraftActionKey(direction, mode, token);
  const draftRestoreRef = useRef<string | null>(null);
  const contextAppliedRef = useRef(false);

  // History stores only a primitive form snapshot. Try every supported bridge
  // scope and accept a draft only after the wallet, chain, operation, and
  // stable caller-known action key all match. The route is still rebuilt and
  // simulated by ActionReview; no executable route data is restored.
  useEffect(() => {
    if (!wallet.ready || !wallet.authenticated || !wallet.address || typeof window === 'undefined') return;
    const search = window.location.search;
    if (draftRestoreRef.current === search) return;
    draftRestoreRef.current = search;
    for (const candidate of MOVE_DRAFT_CANDIDATES) {
      const candidateChainId: FxChainId = candidate.direction === 'ethereum_to_base' ? 1 : 8453;
      const restored = restoreSignatureRequiredDraftFromSearch(search, {
        walletAddress: wallet.address as Address,
        chainId: candidateChainId,
        operation: 'buildBridgeTx',
        actionKey: moveDraftActionKey(candidate.direction, candidate.mode, candidate.token),
      });
      if (!restored) continue;
      const state = restored.formState;
      const restoredDirection = draftEnum(state.direction, ['ethereum_to_base', 'base_to_ethereum'] as const, candidate.direction);
      const restoredMode = draftEnum(state.mode, ['canonical', 'advanced'] as const, candidate.mode);
      const restoredToken = draftEnum(state.token, ['fxUSD', 'fxSAVE'] as const, candidate.token);
      // A tampered form snapshot must never silently change the action scope
      // represented by its stable draft key. Older drafts may omit these
      // fields, so only an explicitly conflicting value rejects the draft.
      if ((state.direction !== undefined && restoredDirection !== candidate.direction)
        || (state.mode !== undefined && restoredMode !== candidate.mode)
        || (state.token !== undefined && restoredToken !== candidate.token)) continue;
      setDirection(candidate.direction);
      // Advanced drafts are restored into the canonical editor; custom
      // contract routing is no longer exposed by the product.
      setToken(candidate.token);
      setAmount(draftString(state.amount));
      setRecipientInput(draftString(state.recipientInput));
      setCustomRecipient(draftBoolean(state.customRecipient));
      setReviewStage('input');
      setReviewRevision((revision) => revision + 1);
      setResumeReview((revision) => revision + 1);
      break;
    }
  }, [wallet.address, wallet.authenticated, wallet.ready]);

  useEffect(() => {
    if (contextAppliedRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('fxDraft')) return;
    const nextToken = params.get('token');
    if (nextToken === 'fxUSD' || nextToken === 'fxSAVE') setToken(nextToken);
    contextAppliedRef.current = true;
  }, []);

  const resetBridgeContext = useCallback((nextToken: BridgeAsset = token) => {
    const defaults = resetTransactionAmounts();
    setToken(nextToken);
    setAmount(defaults.amount);
    setRecipientInput('');
    setCustomRecipient(false);
    setReviewStage('input');
    reviewedBridgeRef.current = null;
    setReviewRevision((revision) => revision + 1);
  }, [token]);

  const changeDirection = useCallback(() => {
    setDirection((current) => current === 'ethereum_to_base' ? 'base_to_ethereum' : 'ethereum_to_base');
    resetBridgeContext();
  }, [resetBridgeContext]);

  const changeToken = useCallback((nextToken: BridgeAsset) => {
    resetBridgeContext(nextToken);
  }, [resetBridgeContext]);

  const changeRecipientMode = useCallback(() => {
    const next = !customRecipient;
    setCustomRecipient(next);
    setRecipientInput(next && wallet.address ? wallet.address : '');
    reviewedBridgeRef.current = null;
    setReviewRevision((revision) => revision + 1);
  }, [customRecipient, wallet.address]);

  useEffect(() => {
    const context = `${wallet.address?.toLowerCase() ?? ''}:${wallet.chainId ?? ''}`;
    const previous = previousWalletContextRef.current;
    const currentAddress = wallet.address?.toLowerCase() ?? null;
    const walletChanged = Boolean(lastConnectedWalletRef.current)
      && lastConnectedWalletRef.current !== currentAddress;
    const chainChanged = wallet.chainId !== undefined
      && lastConnectedChainRef.current !== undefined
      && lastConnectedChainRef.current !== wallet.chainId;
    if (previous !== null && previous !== context && (walletChanged || chainChanged)) resetBridgeContext();
    previousWalletContextRef.current = context;
    if (currentAddress) lastConnectedWalletRef.current = currentAddress;
    if (wallet.chainId !== undefined) lastConnectedChainRef.current = wallet.chainId;
  }, [resetBridgeContext, wallet.address, wallet.chainId]);

  const balanceQuery = useMoveBalances({ address: wallet.address, chainId: sourceChainId, enabled: true });
  const moveBalances = balanceQuery.data?.balances;
  const moveBalanceStatusForPicker = wallet.address
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
      await withReadDeadline(Promise.all([
        assertPublicClientChain(getPublicClient(sourceChainId), sourceChainId),
        assertPublicClientChain(getPublicClient(destinationChainId), destinationChainId),
      ]));
      const sdk = getFxReadFacade();
      const sourceOftAddress = resolveBridgeTokenAddress(token, sourceChainId);
      const sourceTokenAddress = sourceChainId === 1 ? resolveBridgeApprovalTokenAddress(token, sourceChainId) : sourceOftAddress;
      const destinationOftAddress = resolveBridgeTokenAddress(token, destinationChainId);
      const destinationTokenAddress = destinationChainId === 1
        ? resolveBridgeApprovalTokenAddress(token, destinationChainId)
        : destinationOftAddress;
      const approvalTokenAddress = sourceChainId === 1 ? resolveBridgeApprovalTokenAddress(token, sourceChainId) : undefined;
      const sourceApprovalRequired = sourceChainId === 1;
      const destinationApprovalRequired = false;

      // Capture a destination-chain block before the source route can reach a
      // wallet prompt. Delivery is later correlated by LayerZero GUID and
      // OFTReceived logs from this block onward; a balance delta is never used
      // as proof.
      const destinationBaselineBlock = await getPublicClient(destinationChainId).getBlockNumber();

      const sourceToken = token;
      const quote = await sdk.getBridgeQuote({ sourceChainId, destChainId: destinationChainId, token: sourceToken, amount: amountWei, recipient, sourceRpcUrl: requireRpcUrl(sourceChainId) });
      // Build once without an approval so the exact SDK bridge destination is
      // known, then read the allowance for that exact spender. The final route
      // adds one exact approval only when it is still needed.
      const unapproved = await planBridgeRoute({ sourceChainId, destChainId: destinationChainId, token: sourceToken, amount: amountWei, recipient, refundAddress: signer, walletAddress: signer, sourceRpcUrl: requireRpcUrl(sourceChainId), includeApproval: false, destinationOftAddress, destinationBaselineBlock });
      const reviewedSourceOft = assertBridgeActionTarget(unapproved, sourceOftAddress);
      const approvalAllowance = sourceChainId === 1 && sourceApprovalRequired
        ? await getBridgeApprovalAllowance({ client: getPublicClient(sourceChainId), tokenAddress: approvalTokenAddress!, owner: signer, spender: reviewedSourceOft.to })
        : undefined;
      const route = await planBridgeRoute({ sourceChainId, destChainId: destinationChainId, token: sourceToken, amount: amountWei, recipient, refundAddress: signer, walletAddress: signer, sourceRpcUrl: requireRpcUrl(sourceChainId), includeApproval: true, approvalAllowance, approvalTokenAddress, destinationOftAddress, destinationBaselineBlock });
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
        quote: {
          ...(route.quote as { nativeFee: bigint; lzTokenFee: bigint }),
          requestedQuote: quote,
          bridgeToken: token,
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
  }, [amountWei, destinationChainId, recipientValue, sourceChainId, token, wallet.address]);

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
    <AppShell title="Move">
      <div className={`${styles.workspace} ${styles.moveWorkspace}`}>
        <Card
          data-flow-stage={reviewStage}
          className={`${styles.focusCard} ${styles.moveCard} p-5`}
        >
          <ActionReview
            key={reviewRevision}
            surface="content"
            editor={<>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`${styles.eyebrow} ${styles.moveEyebrow}`}>Cross-chain transfer</p>
              <h2 className="mt-1 text-[22px] font-semibold tracking-[-.03em]">Bridge</h2>
              <p className={`${styles.supportCopy} ${styles.moveSupportCopy}`}>{sourceName} to {destinationName}</p>
            </div>
            <span className="rounded-lg bg-[var(--mint-dim)] px-2.5 py-1 text-[11px] font-semibold text-mint">
              {token}
            </span>
          </div>

          <div className={`mt-5 ${styles.networkFlow} ${styles.moveNetworkFlow}`}>
            <NetworkField label="From" name={sourceName} chainId={sourceChainId} />
            <button
              type="button"
              aria-label={`Reverse route to ${sourceName}`}
              onClick={changeDirection}
              className={`glass-press ${styles.networkArrow}`}
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <NetworkField label="To" name={destinationName} chainId={destinationChainId} />
          </div>

          <div className="my-4 hairline" />
          <div className={styles.moveFormFields}>
            <TokenSelect label="Asset" value={token} options={['fxUSD', 'fxSAVE'] as const} onChange={changeToken} balances={moveBalances} balanceStatus={wallet.address ? moveBalanceStatusForPicker : 'disconnected'} />

            <div className={`${styles.amountHero} ${styles.moveAmountHero}`}>
              <AmountField
                label="Amount"
                hint={`From ${sourceName}`}
                symbol={token}
                value={amount}
                onChange={setAmount}
                maxDecimals={18}
                balanceState={moveBalanceState}
              />
            </div>

            <div className={styles.recipientSection}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[12px] font-medium text-mut">Recipient</span>
                <button
                  type="button"
                  onClick={changeRecipientMode}
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
                  <span className="text-[12px] text-mut">{wallet.address ? 'Connected wallet' : 'Connect wallet in Review'}</span>
                  {wallet.address ? (
                    <span className="font-mono text-[12px] font-semibold">
                      {`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`}
                    </span>
                  ) : <span className="text-right text-[11px] font-semibold text-mut">Connect in review</span>}
                </div>
              )}
            </div>

            <BridgePreview
              sourceName={sourceName}
              destinationName={destinationName}
              amount={amount}
              token={token}
              amountValid={Boolean(amountWei)}
            />
          </div>
            </>}
            planBuilder={planBuilder}
            label={`Review move to ${destinationName}`}
            operationLabel={`Move ${token} to ${destinationName}`}
            draftActionKey={draftActionKey}
            draftState={draftState}
            resumeReview={resumeReview}
            onStageChange={setReviewStage}
            onComplete={async () => {
              try {
                await rereadBridgeState();
              } finally {
                await balanceQuery.refresh();
              }
            }}
          />
        </Card>
      </div>
    </AppShell>
  );
}

function BridgePreview({ sourceName, destinationName, amount, token, amountValid }: { sourceName: string; destinationName: string; amount: string; token: BridgeAsset; amountValid: boolean }) {
  const enteredAmount = amount.trim();
  return (
    <section className={styles.bridgePreview} aria-label="Bridge route preview">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-mut">Route preview</span>
        <span className="text-[11px] text-[var(--mut-2)]">Canonical bridge</span>
      </div>
      <div className={styles.bridgePreviewGrid}>
        <PreviewMetric label="Send amount" value={amountValid ? `${enteredAmount} ${token}` : enteredAmount ? 'Enter a valid amount' : '—'} />
        <PreviewMetric label="Network fee" value="Shown after review" />
        <PreviewMetric label="Route" value={`${sourceName} → ${destinationName}`} />
      </div>
      {amountValid ? (
        <p className="text-[10.5px] leading-relaxed text-[var(--mut-2)]" role="status">
          The verified destination amount and minimum received appear after review.
        </p>
      ) : !enteredAmount ? (
        <p className="text-[10.5px] leading-relaxed text-[var(--mut-2)]" role="status">
          Enter an amount to preview the bridge route.
        </p>
      ) : null}
    </section>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2">
      <span className="block truncate text-[10px] text-mut">{label}</span>
      <span className="mt-0.5 block truncate text-[11px] font-semibold">{value}</span>
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
