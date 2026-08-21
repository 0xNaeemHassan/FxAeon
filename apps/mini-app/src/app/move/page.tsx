'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PROTOCOL_TOKENS } from '@fxaeon/shared';
import { AlertTriangle, ArrowDown, ArrowLeftRight, Fuel, Network, PauseCircle, QrCode, RefreshCw, Route, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { AppShell, Button, Card, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import { AmountField, InfoNote, Segmented, TokenSelect } from '@/components/ProtocolForm';
import { BridgeTracker } from '@/components/BridgeTracker';
import { getBridgeState, type BridgeChainState, type BridgeState, type MiniActionParams } from '@/lib/api';
import { compareExactDecimals, decimalToUnits, formatExactDecimal, positiveDecimal } from '@/lib/amount';
import { useLiveRefresh } from '@/lib/useLiveRefresh';

type Direction = 'ethereum_to_base' | 'base_to_ethereum';
type BridgeAsset = 'fxUSD' | 'fxSAVE';

export default function MovePage() {
  const [direction, setDirection] = useState<Direction>('ethereum_to_base');
  const [token, setToken] = useState<BridgeAsset>('fxUSD');
  const [amount, setAmount] = useState('');
  const [bridgeState, setBridgeState] = useState<BridgeState | null>(null);
  const [stateLoading, setStateLoading] = useState(true);
  const [stateError, setStateError] = useState('');

  const loadBridgeState = useCallback(async () => {
    setStateLoading(true);
    setStateError('');
    try {
      setBridgeState(await getBridgeState());
    } catch (cause) {
      setBridgeState(null);
      setStateError(cause instanceof Error ? cause.message : 'Bridge readiness is unavailable.');
    } finally {
      setStateLoading(false);
    }
  }, []);

  useEffect(() => { void loadBridgeState(); }, [loadBridgeState]);
  useLiveRefresh(loadBridgeState);
  const validAmount = positiveDecimal(amount, PROTOCOL_TOKENS[token].decimals);
  const amountUnits = validAmount ? decimalToUnits(validAmount, PROTOCOL_TOKENS[token].decimals) : null;
  const bridgeTooSmall = amountUnits !== null && amountUnits < 10n ** 14n;

  const sourceKey = direction === 'ethereum_to_base' ? 'ethereum' : 'base';
  const destinationKey = direction === 'ethereum_to_base' ? 'base' : 'ethereum';
  const sourceState = bridgeState?.[sourceKey] ?? null;
  const destinationState = bridgeState?.[destinationKey] ?? null;
  const sourceBalance = sourceState?.known ? sourceState.assets[token] : null;
  const balanceComparison = validAmount && sourceBalance !== null
    ? compareExactDecimals(validAmount, sourceBalance, PROTOCOL_TOKENS[token].decimals)
    : null;
  const insufficientBalance = balanceComparison === 1;
  const nativeGasAvailable = Boolean(
    sourceState?.known && sourceState.native && positiveDecimal(sourceState.native, 18)
  );
  const executionPaused = bridgeState?.enabled === false;
  const sourceUnavailable = !stateLoading && Boolean(bridgeState) && sourceState?.known !== true;
  const destinationUnavailable = !stateLoading && Boolean(bridgeState) && destinationState?.known !== true;
  const readinessBlocked = stateLoading || Boolean(stateError) || !bridgeState || executionPaused || sourceUnavailable || destinationUnavailable || !nativeGasAvailable || insufficientBalance;

  const params = useMemo<MiniActionParams | null>(
    () => validAmount && !bridgeTooSmall && !readinessBlocked
      ? { kind: 'bridge', token, amount: validAmount, direction }
      : null,
    [bridgeTooSmall, direction, readinessBlocked, token, validAmount]
  );
  const from = direction === 'ethereum_to_base' ? 'Ethereum' : 'Base';
  const to = direction === 'ethereum_to_base' ? 'Base' : 'Ethereum';
  const amountConstraint = bridgeTooSmall
    ? 'LayerZero credits four decimals; enter at least 0.0001.'
    : insufficientBalance && sourceBalance !== null
      ? `Amount exceeds your ${formatExactDecimal(sourceBalance, 6)} ${token} balance on ${from}.`
      : null;

  return (
    <AppShell title="Move" subtitle="Bridge f(x) assets between Ethereum and Base through the SDK’s LayerZero V2 route.">
      <div className="stagger flex flex-col gap-3.5">
        <Card glow className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">Cross-chain gateway</p><h2 className="text-display mt-2 text-[25px] font-semibold">One wallet. Two networks.</h2><p className="mt-1 text-[11px] leading-relaxed text-mut">Same recipient address, protocol-native OFT transfer.</p></div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><Network className="h-5 w-5" /></span>
          </div>
          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
            <ChainCard name={from} state={sourceState} token={token} role="Source" loading={stateLoading} />
            <span aria-hidden="true" className="flex h-11 w-11 self-center items-center justify-center rounded-full border border-[var(--line)] bg-[var(--bg)] text-mint"><ArrowLeftRight className="h-4 w-4" /></span>
            <ChainCard name={to} state={destinationState} token={token} role="Destination" loading={stateLoading} />
          </div>
        </Card>

        {stateLoading && (
          <LoadingRegion label="Loading Ethereum and Base bridge readiness">
            <Skeleton className="h-20" />
          </LoadingRegion>
        )}

        {!stateLoading && stateError && (
          <ReadinessNotice
            icon={RefreshCw}
            title="Bridge readiness unavailable"
            body={`${stateError} No balance is treated as zero; review stays disabled until a fresh read succeeds.`}
            action={<Button variant="ghost" onClick={() => void loadBridgeState()}><RefreshCw aria-hidden="true" className="h-4 w-4" /> Retry readiness</Button>}
          />
        )}

        {!stateLoading && !stateError && executionPaused && (
          <ReadinessNotice
            icon={PauseCircle}
            title="Bridge execution paused"
            body="Your live balances remain visible, but the operator has paused new bridge quotes and transactions. No transaction can be sent from this screen."
          />
        )}

        {!stateLoading && !stateError && !executionPaused && sourceUnavailable && (
          <ReadinessNotice
            icon={AlertTriangle}
            title={`${from} balance unavailable`}
            body={`The ${from} RPC could not verify your source asset or gas balance. Review stays disabled instead of treating unknown values as zero.`}
            action={<Button variant="ghost" onClick={() => void loadBridgeState()}><RefreshCw aria-hidden="true" className="h-4 w-4" /> Retry {from}</Button>}
          />
        )}

        {!stateLoading && !stateError && !executionPaused && !sourceUnavailable && destinationUnavailable && (
          <ReadinessNotice
            icon={AlertTriangle}
            title={`${to} destination unavailable`}
            body={`The ${to} RPC could not verify destination readiness. Review stays disabled so an unreadable destination cannot be mistaken for a deliverable route.`}
            action={<Button variant="ghost" onClick={() => void loadBridgeState()}><RefreshCw aria-hidden="true" className="h-4 w-4" /> Retry {to}</Button>}
          />
        )}

        {!stateLoading && !stateError && !executionPaused && !destinationUnavailable && sourceState?.known && !nativeGasAvailable && (
          <ReadinessNotice
            icon={Fuel}
            title={`Add ETH for gas on ${from}`}
            body={`This wallet has no verified native ETH on ${from}. Source-chain gas and the LayerZero native fee must be paid before a bridge can be reviewed.`}
          />
        )}

        <Segmented
          value={direction}
          onChange={setDirection}
          ariaLabel="Bridge direction"
          options={[{ value: 'ethereum_to_base', label: 'To Base', sub: 'Ethereum → Base' }, { value: 'base_to_ethereum', label: 'To Ethereum', sub: 'Base → Ethereum' }]}
        />

        <Card className="p-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--mint-dim)] text-mint"><Route className="h-5 w-5" /></span><div><h2 className="text-[14px] font-semibold">Bridge {from} → {to}</h2><p className="mt-0.5 text-[10.5px] text-mut">LayerZero V2 · destination is your same wallet.</p></div></div>
            <TokenSelect label="Asset" value={token} options={['fxUSD', 'fxSAVE'] as const} onChange={setToken} />
            <AmountField
              label={`Amount on ${from}`}
              symbol={token}
              value={amount}
              onChange={setAmount}
              balance={stateLoading ? undefined : sourceBalance}
              maxDecimals={PROTOCOL_TOKENS[token].decimals}
              hint="Minimum 0.0001"
              constraintError={amountConstraint}
            />
            <div className="relative flex flex-col gap-2 rounded-[20px] border border-[var(--line)] bg-[rgba(255,255,255,.025)] p-3.5">
              <BridgeRow label="Source" value={`${from} (${from === 'Ethereum' ? 1 : 8453})`} />
              <span className="absolute left-[26px] top-[43px] h-5 w-px bg-[var(--line-strong)]" />
              <ArrowDown className="absolute left-[19px] top-[47px] h-3.5 w-3.5 rounded-full bg-[var(--surface)] text-mint" />
              <BridgeRow label="Destination" value={`${to} (${to === 'Ethereum' ? 1 : 8453})`} />
              <BridgeRow label="Recipient" value="Same wallet address" />
            </div>
            <InfoNote>The live review includes the native LayerZero fee. Arrival time is controlled by the source chain and LayerZero; FxAeon never fabricates an ETA.</InfoNote>
          </div>
        </Card>

        {validAmount && !bridgeTooSmall && (
          <BridgeTracker
            sourceChain={from as 'Ethereum' | 'Base'}
            destinationChain={to as 'Ethereum' | 'Base'}
            token={token}
            amount={validAmount}
            status="in_flight"
          />
        )}

        <ActionReview params={params} disabled={readinessBlocked} label={`Review bridge to ${to}`} onComplete={() => void loadBridgeState()} />

        <Link href="/qr" className="glass glass-press flex min-h-[72px] items-center gap-3 p-3.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--success-dim)] text-success"><QrCode className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">Wallet deposit address</span><span className="mt-0.5 block text-[10.5px] text-mut">Use the same address on Ethereum or Base</span></span>
          <ShieldCheck className="h-4 w-4 text-mut" />
        </Link>
      </div>
    </AppShell>
  );
}

function ChainCard({
  name,
  state,
  token,
  role,
  loading,
}: {
  name: 'Ethereum' | 'Base';
  state: BridgeChainState | null;
  token: BridgeAsset;
  role: 'Source' | 'Destination';
  loading: boolean;
}) {
  const asset = state?.known ? state.assets[token] : null;
  const native = state?.known ? state.native : null;
  return (
    <div aria-label={`${name} ${role.toLowerCase()} bridge wallet state`} className={`min-w-0 rounded-2xl border p-3 text-center ${role === 'Source' ? 'border-[rgba(139,109,255,.35)] bg-[var(--mint-dim)]' : 'border-transparent bg-[rgba(255,255,255,.035)]'}`}>
      <span aria-hidden="true" className={`mx-auto mb-2 block h-6 w-6 rounded-full ${name === 'Ethereum' ? 'bg-[linear-gradient(145deg,#b9a8ff,#6546e8)]' : 'bg-[#1652f0]'}`} />
      <span className="block text-[12px] font-semibold">{name}</span>
      <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-mint">{role}</span>
      {loading ? (
        <span className="mt-2 block text-[10px] text-mut">Loading…</span>
      ) : state?.known && asset !== null && native !== null ? (
        <>
          <span title={`${asset} ${token}`} className="mt-2 block truncate text-[11px] font-semibold">{formatExactDecimal(asset, 4)} {token}</span>
          <span title={`${native} ETH available for gas`} className="mt-1 block truncate text-[10px] text-mut">{formatExactDecimal(native, 5)} ETH gas</span>
        </>
      ) : (
        <>
          <span className="mt-2 block text-[10px] font-medium text-warn">Balance unavailable</span>
          <span className="mt-1 block text-[10px] text-mut">Gas unavailable</span>
        </>
      )}
    </div>
  );
}

function ReadinessNotice({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof AlertTriangle;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="border-[rgba(255,194,102,.24)] p-3.5">
      <div role="status" className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--warn-dim)] text-warn"><Icon aria-hidden="true" className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{title}</span><span className="mt-1 block text-[11px] leading-relaxed text-mut">{body}</span></span>
      </div>
      {action && <div className="mt-3">{action}</div>}
    </Card>
  );
}

function BridgeRow({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-8 items-center justify-between gap-4 pl-8 text-[11px]"><span className="text-mut">{label}</span><span className="text-right font-semibold">{value}</span></div>;
}
