'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PROTOCOL_TOKENS } from '@fxaeon/shared';
import { ArrowDownToLine, ArrowUpFromLine, Clock3, Layers3, Sparkles } from 'lucide-react';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import { AmountField, InfoNote, Segmented, TokenSelect, ToggleRow } from '@/components/ProtocolForm';
import {
  getMe,
  getProtocol,
  type Me,
  type MiniActionParams,
  type ProtocolInfo,
} from '@/lib/api';
import { formatExactDecimal, positiveDecimal } from '@/lib/amount';
import { useLiveRefresh } from '@/lib/useLiveRefresh';

type EarnMode = 'deposit' | 'withdraw' | 'claim';
type SaveAsset = 'USDC' | 'fxUSD' | 'fxUSDBasePool';

function compact(value: string | number | null | undefined, digits = 4): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return formatExactDecimal(value, digits);
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export default function EarnPage() {
  const [mode, setMode] = useState<EarnMode>('deposit');
  const [me, setMe] = useState<Me | null>(null);
  const [protocol, setProtocol] = useState<ProtocolInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState<SaveAsset>('fxUSD');
  const [amount, setAmount] = useState('');
  const [shares, setShares] = useState('');
  const [instant, setInstant] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [account, info] = await Promise.all([getMe(), getProtocol()]);
      setMe(account);
      setProtocol(info);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Live savings data is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  const params = useMemo<MiniActionParams | null>(() => {
    if (mode === 'claim') return { kind: 'save_claim' };
    if (mode === 'deposit') {
      const validAmount = positiveDecimal(amount, PROTOCOL_TOKENS[token].decimals);
      return validAmount ? { kind: 'save_deposit', tokenIn: token, amount: validAmount } : null;
    }
    const validShares = shares === 'all' ? 'all' : positiveDecimal(shares, PROTOCOL_TOKENS.fxSAVE.decimals);
    if (!validShares) return null;
    return { kind: 'save_withdraw', tokenOut: token, shares: validShares, instant: token === 'fxUSDBasePool' ? false : instant };
  }, [amount, instant, mode, shares, token]);

  const balance = me?.funding?.balances?.[token];
  const holding = me?.savings;
  const save = protocol?.save;

  return (
    <AppShell title="Earn" subtitle="The complete fxSAVE lifecycle, powered by live protocol state.">
      <div className="stagger flex flex-col gap-3.5">
        <Card glow className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mint">f(x) Stability Pool</p>
              <p className="text-display mt-2 text-[31px] font-semibold tracking-[-0.05em]">
                {loading ? '—' : `${compact(save?.assetsPerShare, 6)} fxUSD`}
              </p>
              <p className="mt-1 text-[11px] text-mut">Assets per fxSAVE share · live SDK value</p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint">
              <Sparkles className="h-5 w-5" />
            </span>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Metric label="Your shares" value={compact(holding?.shares)} />
            <Metric label="Cooldown" value={save ? `${compact(save.cooldownHours, 1)}h` : '—'} />
            <Metric label="Instant fee" value={save ? `${compact(save.instantRedeemFeePct, 3)}%` : '—'} />
          </div>
        </Card>

        {loading ? (
          <LoadingRegion label="Loading live savings data" className="flex flex-col gap-3.5">
            <Skeleton className="h-12" /><Skeleton className="h-72" />
          </LoadingRegion>
        ) : error ? (
          <EmptyState
            icon={Layers3}
            title="Savings data unavailable"
            body={error}
            action={<Button onClick={() => void load()}>Retry</Button>}
          />
        ) : (
          <>
            <Segmented
              value={mode}
              onChange={(next) => {
                setMode(next);
                setToken('fxUSD');
              }}
              ariaLabel="Savings action"
              options={[
                { value: 'deposit', label: 'Deposit' },
                { value: 'withdraw', label: 'Withdraw' },
                { value: 'claim', label: 'Claim' },
              ]}
            />

            <Card className="p-4">
              {mode === 'deposit' && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--success-dim)] text-success"><ArrowDownToLine className="h-5 w-5" /></span>
                    <div><h2 className="text-[15px] font-semibold">Deposit assets</h2><p className="text-[10.5px] text-mut">Mint fxSAVE shares at the current exchange rate.</p></div>
                  </div>
                  <TokenSelect label="Deposit token" value={token} options={['fxUSD', 'USDC', 'fxUSDBasePool'] as const} onChange={setToken} />
                  <AmountField label="Amount" symbol={token} value={amount} onChange={setAmount} balance={balance} maxDecimals={PROTOCOL_TOKENS[token].decimals} />
                  <InfoNote>Yield is reflected in assets per share. This screen intentionally does not invent or annualize an APY the SDK does not provide.</InfoNote>
                </div>
              )}

              {mode === 'withdraw' && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--warn-dim)] text-warn"><ArrowUpFromLine className="h-5 w-5" /></span>
                    <div><h2 className="text-[15px] font-semibold">Redeem shares</h2><p className="text-[10.5px] text-mut">Choose an instant swap, cooldown queue, or direct base-pool redeem.</p></div>
                  </div>
                  <TokenSelect label="Receive token" value={token} options={['fxUSD', 'USDC', 'fxUSDBasePool'] as const} onChange={setToken} />
                  <AmountField label="fxSAVE shares" symbol="fxSAVE" value={shares} onChange={setShares} balance={holding?.shares ?? '0'} allowAll maxDecimals={PROTOCOL_TOKENS.fxSAVE.decimals} />
                  {token !== 'fxUSDBasePool' && (
                    <ToggleRow
                      checked={instant}
                      onChange={setInstant}
                      title="Instant redemption"
                      body={instant ? `No cooldown · live fee ${compact(save?.instantRedeemFeePct, 3)}%` : `No instant fee · claim after ${compact(save?.cooldownHours, 1)} hours`}
                    />
                  )}
                  {token === 'fxUSDBasePool' && <InfoNote>The SDK redeems fxSAVE directly into the base-pool token in one vault call. There is no cooldown and no instant-swap fee.</InfoNote>}
                </div>
              )}

              {mode === 'claim' && (
                <div className="flex flex-col items-center px-2 py-4 text-center">
                  <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${holding?.redeemReady ? 'bg-[var(--success-dim)] text-success' : 'bg-[var(--mint-dim)] text-mint'}`}>
                    <Clock3 className="h-6 w-6" />
                  </span>
                  <h2 className="text-display mt-4 text-[20px] font-semibold">
                    {holding?.redeemReady ? 'Redemption ready' : holding?.pendingRedeem ? 'Cooldown in progress' : 'No pending redemption'}
                  </h2>
                  <p className="mt-1.5 max-w-[290px] text-[11.5px] leading-relaxed text-mut">
                    {holding?.redeemReady
                      ? 'The protocol reports your queued shares as claimable. Review the live receive preview before execution.'
                      : holding?.pendingRedeem
                        ? 'Claim will remain unavailable until the on-chain cooldown has completed.'
                        : 'Start a queued withdrawal first. This action only appears when there is real on-chain state to claim.'}
                  </p>
                </div>
              )}
            </Card>

            <ActionReview
              params={params}
              disabled={mode === 'claim' && !holding?.redeemReady}
              label={mode === 'claim' ? 'Review claim' : mode === 'withdraw' ? 'Review redemption' : 'Review deposit'}
              onComplete={() => void load()}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[rgba(255,255,255,.035)] px-2 py-3 text-center">
      <span className="block truncate text-[9px] uppercase tracking-[0.1em] text-mut">{label}</span>
      <span className="mt-1 block truncate text-[12px] font-semibold">{value}</span>
    </div>
  );
}
