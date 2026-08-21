'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { PROTOCOL_TOKENS } from '@fxaeon/shared';
import { Banknote, Coins, ShieldAlert } from 'lucide-react';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import { HealthGauge } from '@/components/HealthGauge';
import { AmountField, InfoNote, Segmented, TokenSelect } from '@/components/ProtocolForm';
import { getMe, type ApiPosition, type Market, type Me, type MiniActionParams, type ProtocolTokenSymbol } from '@/lib/api';
import { positiveDecimal } from '@/lib/amount';
import { useLiveRefresh } from '@/lib/useLiveRefresh';

type BorrowMode = 'mint' | 'manage';

const DEPOSIT_TOKENS: Record<Market, readonly ProtocolTokenSymbol[]> = {
  wstETH: ['ETH', 'WETH', 'stETH', 'wstETH'],
  WBTC: ['WBTC'],
};

const WITHDRAW_TOKENS = DEPOSIT_TOKENS;
const NEW_POSITION_KEY = 'new';

function positionKey(position: ApiPosition): string {
  const pool = position.market === 'WBTC' ? 'WBTC' : 'wstETH';
  return `${pool}:${position.tokenId}`;
}

export default function BorrowPage() {
  const [mode, setMode] = useState<BorrowMode>('mint');
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [market, setMarket] = useState<Market>('wstETH');
  const [selectedPositionKey, setSelectedPositionKey] = useState(NEW_POSITION_KEY);
  const [token, setToken] = useState<ProtocolTokenSymbol>('ETH');
  const [deposit, setDeposit] = useState('');
  const [mint, setMint] = useState('');
  const [repay, setRepay] = useState('');
  const [withdraw, setWithdraw] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setMe(await getMe());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Borrowing state is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  const borrowingPositions = useMemo(
    () => (me?.positions ?? []).filter((position) => position.side === 'long'),
    [me]
  );
  const selected = borrowingPositions.find((position) => positionKey(position) === selectedPositionKey);

  useEffect(() => {
    const options = mode === 'mint' ? DEPOSIT_TOKENS[market] : WITHDRAW_TOKENS[market];
    if (!options.includes(token)) setToken(options[0]);
  }, [market, mode, token]);

  useEffect(() => {
    if (mode === 'manage' && selected) {
      setMarket(selected.market === 'WBTC' ? 'WBTC' : 'wstETH');
    }
  }, [mode, selected]);

  const params = useMemo<MiniActionParams | null>(() => {
    if (mode === 'mint') {
      const validDeposit = positiveDecimal(deposit, PROTOCOL_TOKENS[token].decimals);
      const validMint = positiveDecimal(mint, PROTOCOL_TOKENS.fxUSD.decimals);
      if (!validDeposit || !validMint) return null;
      const target = borrowingPositions.find((position) => positionKey(position) === selectedPositionKey);
      return {
        kind: 'mint',
        market,
        positionId: target ? Number(target.tokenId) : 0,
        depositToken: token,
        depositAmount: validDeposit,
        mintAmount: validMint,
      };
    }
    if (!selected) return null;
    const validRepay = repay === 'all'
      ? 'all'
      : positiveDecimal(repay, PROTOCOL_TOKENS.fxUSD.decimals);
    const validWithdraw = positiveDecimal(withdraw, PROTOCOL_TOKENS[token].decimals);
    if (!validRepay && !validWithdraw) return null;
    if (repay && repay !== '0' && !validRepay) return null;
    if (withdraw && withdraw !== '0' && !validWithdraw) return null;
    return {
      kind: 'repay_withdraw',
      market: selected.market === 'WBTC' ? 'WBTC' : 'wstETH',
      positionId: Number(selected.tokenId),
      repayAmount: validRepay || '0',
      withdrawToken: token,
      withdrawAmount: validWithdraw || '0',
    };
  }, [borrowingPositions, deposit, market, mint, mode, repay, selected, selectedPositionKey, token, withdraw]);

  const positionsForMarket = borrowingPositions.filter((position) => position.market === market);
  const balance = me?.funding?.balances?.[token];

  return (
    <AppShell title="Borrow" subtitle="Mint fxUSD against collateral, then repay or release it from one mobile flow.">
      <div className="stagger flex flex-col gap-3.5">
        <Card glow className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><Banknote className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-mint">Collateralized fxUSD</p>
              <p className="text-display mt-1 text-[21px] font-semibold">Borrow without selling</p>
              <p className="mt-1 text-[11px] leading-relaxed text-mut">Every transaction is built by the official SDK and ownership-checked on-chain.</p>
            </div>
          </div>
        </Card>

        {loading ? (
          <LoadingRegion label="Loading borrowing positions" className="flex flex-col gap-3.5">
            <Skeleton className="h-12" /><Skeleton className="h-80" />
          </LoadingRegion>
        ) : error ? (
          <EmptyState
            icon={ShieldAlert}
            title="Borrowing data unavailable"
            body={error}
            action={<Button onClick={() => void load()}>Retry</Button>}
          />
        ) : (
          <>
            <Segmented
              value={mode}
              onChange={(next) => {
                setMode(next);
                setSelectedPositionKey(next === 'mint'
                  ? NEW_POSITION_KEY
                  : borrowingPositions[0]
                    ? positionKey(borrowingPositions[0])
                    : '');
                setRepay('');
                setWithdraw('0');
              }}
              ariaLabel="Borrow action"
              options={[{ value: 'mint', label: 'Mint fxUSD' }, { value: 'manage', label: 'Repay & release' }]}
            />

            {mode === 'manage' && borrowingPositions.length === 0 ? (
              <EmptyState icon={Coins} title="No borrowing positions" body="Open a collateralized fxUSD position first. Leveraged short positions are managed from Positions, not here." />
            ) : (
              <Card className="p-4">
                <div className="flex flex-col gap-4">
                  {mode === 'mint' ? (
                    <>
                      <Segmented
                        value={market}
                        onChange={(next) => {
                          setMarket(next);
                          setSelectedPositionKey(NEW_POSITION_KEY);
                        }}
                        ariaLabel="Collateral market"
                        options={[{ value: 'wstETH', label: 'ETH market' }, { value: 'WBTC', label: 'BTC market' }]}
                      />
                      <PositionSelect
                        label="Borrowing position"
                        value={selectedPositionKey}
                        positions={positionsForMarket}
                        allowNew
                        onChange={setSelectedPositionKey}
                      />
                      <TokenSelect label="Deposit collateral" value={token} options={DEPOSIT_TOKENS[market]} onChange={setToken} />
                      <AmountField label="Collateral amount" symbol={token} value={deposit} onChange={setDeposit} balance={balance} maxDecimals={PROTOCOL_TOKENS[token].decimals} />
                      <AmountField label="Mint amount" symbol="fxUSD" value={mint} onChange={setMint} maxDecimals={PROTOCOL_TOKENS.fxUSD.decimals} />
                      <InfoNote>Minting creates protocol debt. Review the SDK execution price and keep enough collateral headroom for market moves.</InfoNote>
                    </>
                  ) : (
                    <>
                      <PositionSelect label="Position to manage" value={selectedPositionKey} positions={borrowingPositions} onChange={setSelectedPositionKey} />
                      {selected && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <MiniStat label="Debt" value={`${selected.debt} ${selected.debtToken ?? 'fxUSD'}`} />
                            <MiniStat label="Collateral" value={`${selected.collateral} ${selected.collateralToken ?? selected.market}`} />
                          </div>
                          <HealthGauge
                            mode="health"
                            value={selected.healthPercent}
                            side="long"
                            market={selected.market}
                          />
                        </>
                      )}
                      <AmountField label="Repay fxUSD" symbol="fxUSD" value={repay} onChange={setRepay} balance={me?.funding?.balances?.fxUSD} allowAll allowZero maxDecimals={PROTOCOL_TOKENS.fxUSD.decimals} />
                      <TokenSelect label="Withdraw collateral as" value={token} options={WITHDRAW_TOKENS[market]} onChange={setToken} />
                      <AmountField label="Collateral to release" symbol={token} value={withdraw} onChange={setWithdraw} placeholder="0 for repay only" allowZero maxDecimals={PROTOCOL_TOKENS[token].decimals} />
                      <InfoNote>You can repay only, withdraw only, or combine both. The server clamps “all” to the live debt and simulates solvency before broadcast.</InfoNote>
                    </>
                  )}
                </div>
              </Card>
            )}

            <ActionReview params={params} label={mode === 'mint' ? 'Review mint' : 'Review repayment'} onComplete={() => void load()} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function PositionSelect({
  label,
  value,
  positions,
  allowNew = false,
  onChange,
}: {
  label: string;
  value: string;
  positions: ApiPosition[];
  allowNew?: boolean;
  onChange: (value: string) => void;
}) {
  const selectId = useId();
  return (
    <div>
      <label htmlFor={selectId} className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.15em] text-mut">{label}</label>
      <select
        id={selectId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-14 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-[13px] font-semibold outline-none focus:border-[rgba(139,109,255,.5)]"
      >
        {allowNew && <option value={NEW_POSITION_KEY}>New collateral position</option>}
        {positions.map((position) => (
          <option key={positionKey(position)} value={positionKey(position)}>
            #{position.tokenId} · {position.market} · {position.collateral} collateral · {position.debt} debt
          </option>
        ))}
      </select>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-[rgba(255,255,255,.035)] p-3"><span className="block text-[9px] uppercase tracking-[0.12em] text-mut">{label}</span><span className="mt-1 block truncate text-[12px] font-semibold">{value}</span></div>;
}
