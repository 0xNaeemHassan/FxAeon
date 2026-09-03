'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, InfoNote, Segmented, TokenSelect, useWalletTokenBalances } from '@/components/ProtocolForm';
import { useUsdPrices } from '@/components/PriceProvider';
import { planDepositAndMint, planRepayAndWithdraw } from '@/lib/fx';
import { usePrivyWallet } from '@/lib/wallet';
import { userSafeError } from '@/lib/errors';
import {
  ETH_MARKET_TOKENS,
  BTC_MARKET_TOKENS,
  formatAmount,
  parseZeroAmount,
  positionCollateralDecimals,
  positionDebtDecimals,
  positionKey,
  readAllPositions,
  tokenAddress,
  tokenDecimals,
  type UiMarket,
  type UiPosition,
  type UiToken,
} from '@/app/trade/fxUi';
import styles from '@/components/FlowWorkspace.module.css';
import { calculatePositionUsdValuation, formatUsdCents } from '@/lib/positionValuation';
import { priceKeyForSymbol } from '@/lib/prices';

type BorrowMode = 'mint' | 'manage';
type PositionState = { walletAddress: string; items: UiPosition[] };

const EMPTY_POSITIONS: UiPosition[] = [];
const ETH_COLLATERAL_TOKENS = ETH_MARKET_TOKENS.filter((item) => !['USDC', 'USDT', 'fxUSD'].includes(item));
const BTC_COLLATERAL_TOKENS = BTC_MARKET_TOKENS.filter((item) => item === 'WBTC');

function collateralTokensForMarket(market: UiMarket): readonly UiToken[] {
  return market === 'ETH' ? ETH_COLLATERAL_TOKENS : BTC_COLLATERAL_TOKENS;
}

export default function BorrowPage() {
  const wallet = usePrivyWallet();
  const [mode, setMode] = useState<BorrowMode>('mint');
  const [market, setMarket] = useState<UiMarket>('ETH');
  const [positionState, setPositionState] = useState<PositionState | null>(null);
  const [selectedKey, setSelectedKey] = useState('new');
  const [token, setToken] = useState<UiToken>('ETH');
  const [deposit, setDeposit] = useState('');
  const [mint, setMint] = useState('');
  const [repay, setRepay] = useState('');
  const [withdraw, setWithdraw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Borrowing is Ethereum-only in the official SDK. Keep the read tied to the
  // selected address while using Ethereum's reviewed client regardless of the
  // wallet's currently displayed chain.
  const balanceSnapshot = useWalletTokenBalances(wallet.address, 1);
  const refreshBalances = balanceSnapshot.refresh;
  const balanceStatus = wallet.address
    ? (balanceSnapshot.status === 'idle' ? 'loading' : balanceSnapshot.status)
    : undefined;
  const balanceStateFor = (key: string) => wallet.address
    ? balanceSnapshot.balances[key] ?? { status: balanceStatus ?? 'loading' as const }
    : undefined;
  const load = useCallback(async () => {
    const address = wallet.address;
    if (!address) {
      setPositionState(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = (await readAllPositions(address)).filter((position) => position.side === 'long');
      setPositionState({ walletAddress: address, items: next });
    } catch (cause) {
      setError(userSafeError(cause, 'Borrowing state is unavailable. Check the Ethereum connection and try again.'));
    } finally {
      setLoading(false);
    }
  }, [wallet.address]);

  const refreshAfterAction = useCallback(async () => {
    await Promise.all([load(), refreshBalances()]);
  }, [refreshBalances, load]);

  useEffect(() => { void load(); }, [load]);

  const positions = useMemo(() => {
    const current = positionState;
    return current && current.walletAddress === wallet.address ? current.items : EMPTY_POSITIONS;
  }, [positionState, wallet.address]);
  const selected = positions.find((position) => positionKey(position) === selectedKey);
  const marketPositions = positions.filter((position) => position.market === market);
  const collateralTokens = collateralTokensForMarket(market);
  const withdrawalTokens = collateralTokensForMarket(selected?.market ?? market);
  const activeTokenOptions = mode === 'manage' ? withdrawalTokens : collateralTokens;

  useEffect(() => {
    setSelectedKey((current) => {
      if (mode === 'mint') {
        return current === 'new' || positions.some((position) => positionKey(position) === current) ? current : 'new';
      }
      return positions.some((position) => positionKey(position) === current)
        ? current
        : positions[0]
          ? positionKey(positions[0])
          : '';
    });
  }, [mode, positions]);

  useEffect(() => {
    if (mode === 'manage' && selected) setMarket(selected.market);
  }, [mode, selected]);

  useEffect(() => {
    if (!activeTokenOptions.includes(token)) setToken(activeTokenOptions[0]);
  }, [activeTokenOptions, token]);

  const planBuilder = useMemo(() => {
    if (!wallet.address) return null;
    if (mode === 'mint') {
      const depositWei = parseZeroAmount(deposit, token);
      const mintWei = parseZeroAmount(mint, 'fxUSD');
      if (depositWei === null || mintWei === null || (depositWei === 0n && mintWei === 0n)) return null;
      return () => planDepositAndMint({
        market,
        positionId: selectedKey === 'new' ? 0 : selected?.info.positionId ?? 0,
        userAddress: wallet.address!,
        depositTokenAddress: tokenAddress(token),
        depositAmount: depositWei,
        mintAmount: mintWei,
      });
    }
    if (!selected) return null;
    const repayWei = repay.toLowerCase() === 'all' ? selected.info.rawDebts : parseZeroAmount(repay, 'fxUSD');
    const withdrawWei = parseZeroAmount(withdraw, token);
    if (repayWei === null || withdrawWei === null || (repayWei === 0n && withdrawWei === 0n)) return null;
    return () => planRepayAndWithdraw({
      market: selected.market,
      positionId: selected.info.positionId,
      userAddress: wallet.address!,
      repayAmount: repayWei,
      withdrawAmount: withdrawWei,
      withdrawTokenAddress: tokenAddress(token),
    });
  }, [deposit, market, mint, mode, repay, selected, selectedKey, token, wallet.address, withdraw]);

  const initialRead = Boolean(wallet.address) && loading && positionState?.walletAddress !== wallet.address;

  return (
    <AppShell title="Borrow" subtitle="Borrow fxUSD without selling your collateral.">
      <div className={styles.workspace}>
        <div className={`grid grid-cols-2 ${styles.productSwitch}`} aria-label="Earn products">
          <Link href="/earn" className="glass-press flex min-h-11 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-mut">fxSAVE</Link>
          <span aria-current="page" className="flex min-h-11 items-center justify-center rounded-lg bg-[var(--mint-dim)] px-3 text-[13px] font-semibold text-[var(--text)]">Borrow / fxMINT</span>
        </div>
        {!wallet.address ? (
          <WalletConnectCTA
            ready={wallet.ready}
            authenticated={wallet.authenticated}
            body="Choose or connect a wallet to view collateral, debt, and borrowing positions."
          />
        ) : initialRead ? (
          <LoadingRegion label="Reading borrowing positions" className="flex flex-col gap-3.5">
            <Skeleton className="h-11" />
            <Skeleton className="h-14" />
            <Skeleton className="h-72" />
          </LoadingRegion>
        ) : error ? (
          <EmptyState
            icon={RefreshCw}
            title="Borrowing state unavailable"
            body={error}
            action={<Button onClick={() => void load()}>Retry</Button>}
          />
        ) : (
          <>
            <div className="rounded-2xl bg-[var(--surface-2,var(--input))] p-1">
              <Segmented
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  setRepay('');
                  setWithdraw('');
                }}
                ariaLabel="Borrow action"
                options={[
                  { value: 'mint', label: 'Deposit & mint' },
                  { value: 'manage', label: 'Manage debt' },
                ]}
              />
            </div>

            {mode === 'mint' ? (
              <>
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2,var(--input))] p-1">
                  <Segmented
                    value={market}
                    onChange={(next) => {
                      setMarket(next);
                      setSelectedKey('new');
                      setToken(next === 'ETH' ? 'ETH' : 'WBTC');
                    }}
                    ariaLabel="Collateral market"
                    options={[
                      { value: 'ETH', label: 'ETH' },
                      { value: 'BTC', label: 'BTC' },
                    ]}
                  />
                </div>

                <PositionSelect
                  value={selectedKey}
                  positions={marketPositions}
                  allowNew
                  newLabel={`New ${market} position`}
                  onChange={setSelectedKey}
                />

                {selected ? (
                  <PositionSummary position={selected} />
                ) : (
                  <p className="px-1 text-[12px] text-mut">A new {market} collateral position will be created.</p>
                )}

                <Card className={`${styles.focusCard} p-5`}>
                  <div className="flex flex-col gap-4">
                    <FormHeader title="Deposit & mint" body="Add collateral, mint fxUSD, or do both." />
                    <TokenSelect label="Collateral asset" value={token} options={collateralTokens} onChange={setToken} balances={balanceSnapshot.status === 'idle' ? undefined : balanceSnapshot.balances} balanceStatus={wallet.address ? balanceStatus : 'disconnected'} />
                    <AmountField
                      label="Collateral amount"
                      symbol={token}
                      value={deposit}
                      onChange={setDeposit}
                      allowZero
                      maxDecimals={tokenDecimals(token)}
                      placeholder="0 for mint only"
                      balanceState={balanceStateFor(token)}
                    />
                    <AmountField
                      label="fxUSD to mint"
                      symbol="fxUSD"
                      value={mint}
                      onChange={setMint}
                      allowZero
                      maxDecimals={18}
                      placeholder="0 for deposit only"
                    />
                    <InfoNote>Minting increases position debt. Leave enough collateral for market moves.</InfoNote>
                  </div>
                </Card>

                <ActionReview
                  planBuilder={planBuilder}
                  label="Review deposit & mint"
                  operationLabel="Deposit collateral and mint fxUSD"
                  onComplete={refreshAfterAction}
                />
              </>
            ) : positions.length === 0 ? (
              <EmptyState
                icon={Coins}
                title="No borrowing positions"
                body="Create an ETH or BTC collateral position to borrow fxUSD."
                action={<Button onClick={() => { setMode('mint'); setSelectedKey('new'); }}>Start borrowing</Button>}
              />
            ) : (
              <>
                <PositionSelect value={selectedKey} positions={positions} onChange={setSelectedKey} />
                {selected && <PositionSummary position={selected} />}

                <Card className={`${styles.focusCard} p-5`}>
                  <div className="flex flex-col gap-4">
                    <FormHeader title="Manage debt" body="Repay fxUSD, withdraw collateral, or do both." />
                    <AmountField
                      label="Repay amount"
                      symbol="fxUSD"
                      value={repay}
                      onChange={setRepay}
                      allowAll
                      allowZero
                      maxDecimals={18}
                      placeholder="0 for withdraw only"
                      balanceState={balanceStateFor('fxUSD')}
                    />
                    <TokenSelect label="Receive collateral as" value={token} options={withdrawalTokens} onChange={setToken} balances={balanceSnapshot.status === 'idle' ? undefined : balanceSnapshot.balances} balanceStatus={wallet.address ? balanceStatus : 'disconnected'} />
                    <AmountField
                      label="Collateral to withdraw"
                      symbol={token}
                      value={withdraw}
                      onChange={setWithdraw}
                      allowZero
                      maxDecimals={tokenDecimals(token)}
                      placeholder="0 for repay only"
                    />
                    <InfoNote>Withdrawing collateral can reduce your safety margin. Review the final amounts before confirming.</InfoNote>
                  </div>
                </Card>

                <ActionReview
                  planBuilder={planBuilder}
                  label="Review changes"
                  operationLabel="Repay fxUSD and withdraw collateral"
                  onComplete={refreshAfterAction}
                />
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function PositionSelect({
  value,
  positions,
  allowNew = false,
  newLabel = 'New collateral position',
  onChange,
}: {
  value: string;
  positions: UiPosition[];
  allowNew?: boolean;
  newLabel?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className={`mb-2 block ${styles.eyebrow}`}>Position</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[56px] w-full rounded-2xl border border-[var(--line)] bg-[var(--input)] px-4 text-[16px] font-semibold outline-none focus:border-mint"
      >
        {allowNew && <option value="new">{newLabel}</option>}
        {positions.map((position) => (
          <option key={positionKey(position)} value={positionKey(position)}>
            #{position.info.positionId} · {position.market} · {formatPositionCollateral(position)} collateral · {formatPositionDebt(position)} debt
          </option>
        ))}
      </select>
    </label>
  );
}

function PositionSummary({ position }: { position: UiPosition }) {
  const { prices, status: priceStatus } = useUsdPrices();
  const collateralKey = priceKeyForSymbol(position.info.rawCollsToken);
  const debtKey = priceKeyForSymbol(position.info.rawDebtsToken);
  const valuation = calculatePositionUsdValuation({
    collateralRaw: position.info.rawColls,
    collateralDecimals: positionCollateralDecimals(position),
    collateralPrice: collateralKey ? prices[collateralKey] : undefined,
    debtRaw: position.info.rawDebts,
    debtDecimals: positionDebtDecimals(position),
    debtPrice: debtKey ? prices[debtKey] : undefined,
  });
  const collateralUsd = formatUsdCents(valuation.collateralUsdCents);
  const debtUsd = formatUsdCents(valuation.debtUsdCents);
  const netEquity = formatUsdCents(valuation.netEquityUsdCents);
  return (
    <Card className={`${styles.summaryCard} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={styles.eyebrow}>Position</p>
          <h2 className="text-display mt-2 text-[19px] font-semibold">{position.market} collateral · #{position.info.positionId}</h2>
        </div>
        <span className="rounded-lg bg-[var(--mint-dim)] px-2 py-1 text-[11px] font-semibold text-mint">Long</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Est. net equity" value={netEquity} />
        <Metric label="Collateral value" value={`${formatPositionCollateral(position)} · ${collateralUsd}`} />
        <Metric label="Debt value" value={`${formatPositionDebt(position)} · ${debtUsd}`} />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-mut">Display estimate: collateral USD minus debt USD, not a close quote or liquidation value.{priceStatus === 'stale' ? ' Last prices.' : ''}</p>
    </Card>
  );
}

function FormHeader({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={`mt-1 ${styles.supportCopy}`}>{body}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${styles.metric} p-3`}>
      <span className="block text-[11px] text-mut">{label}</span>
      <span className="mt-1 block truncate text-[13px] font-semibold tabular-nums" title={value}>{value}</span>
    </div>
  );
}

function formatPositionCollateral(position: UiPosition): string {
  return `${formatAmount(position.info.rawColls, positionCollateralDecimals(position))} ${position.info.rawCollsToken}`;
}

function formatPositionDebt(position: UiPosition): string {
  return `${formatAmount(position.info.rawDebts, positionDebtDecimals(position))} ${position.info.rawDebtsToken}`;
}
