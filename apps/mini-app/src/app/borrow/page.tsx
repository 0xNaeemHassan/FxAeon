'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Coins, RefreshCw } from 'lucide-react';
import { AppShell, Button, Card, EmptyState, LoadingRegion, Skeleton } from '@/components/ui';
import { ActionReview } from '@/components/ActionReview';
import WalletConnectCTA from '@/components/WalletConnectCTA';
import { AmountField, InfoNote, Segmented, TokenSelect } from '@/components/ProtocolForm';
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

type BorrowMode = 'mint' | 'manage';

export default function BorrowPage() {
  const wallet = usePrivyWallet();
  const [mode, setMode] = useState<BorrowMode>('mint');
  const [market, setMarket] = useState<UiMarket>('ETH');
  const [positions, setPositions] = useState<UiPosition[]>([]);
  const [selectedKey, setSelectedKey] = useState('new');
  const [token, setToken] = useState<UiToken>('ETH');
  const [deposit, setDeposit] = useState('');
  const [mint, setMint] = useState('');
  const [repay, setRepay] = useState('');
  const [withdraw, setWithdraw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!wallet.address) { setPositions([]); return; }
    setLoading(true);
    setError('');
    try {
      const next = (await readAllPositions(wallet.address)).filter((position) => position.side === 'long');
      setPositions(next);
      setSelectedKey((current) => current !== 'new' && next.some((position) => positionKey(position) === current) ? current : mode === 'manage' && next[0] ? positionKey(next[0]) : 'new');
    } catch (cause) {
      setError(userSafeError(cause, 'Borrowing state is unavailable. Check the Ethereum connection and try again.'));
    } finally { setLoading(false); }
  }, [mode, wallet.address]);

  useEffect(() => { void load(); }, [load]);

  const selected = positions.find((position) => positionKey(position) === selectedKey);
  const collateralTokens = market === 'ETH' ? ETH_MARKET_TOKENS.filter((item) => !['USDC', 'USDT', 'fxUSD'].includes(item)) : BTC_MARKET_TOKENS.filter((item) => item === 'WBTC');

  useEffect(() => {
    if (mode === 'manage' && selected) setMarket(selected.market);
    const options = mode === 'manage' && selected ? (selected.market === 'ETH' ? ETH_MARKET_TOKENS : BTC_MARKET_TOKENS).filter((item) => !['USDC', 'USDT', 'fxUSD'].includes(item)) : collateralTokens;
    setToken((current) => options.includes(current) ? current : options[0]);
  }, [collateralTokens, mode, selected]);

  const planBuilder = useMemo(() => {
    if (!wallet.address) return null;
    if (mode === 'mint') {
      // The official method supports deposit-only, mint-only, and combined
      // calls. Empty fields are explicit zeroes; reject only an all-zero
      // request in the service layer.
      const depositWei = parseZeroAmount(deposit, token);
      const mintWei = parseZeroAmount(mint, 'fxUSD');
      if (depositWei === null || mintWei === null || (depositWei === 0n && mintWei === 0n)) return null;
      return () => planDepositAndMint({ market, positionId: selectedKey === 'new' ? 0 : selected?.info.positionId ?? 0, userAddress: wallet.address!, depositTokenAddress: tokenAddress(token), depositAmount: depositWei, mintAmount: mintWei });
    }
    if (!selected) return null;
    const repayWei = repay.toLowerCase() === 'all' ? selected.info.rawDebts : parseZeroAmount(repay, 'fxUSD');
    const withdrawWei = parseZeroAmount(withdraw, token);
    if (repayWei === null || withdrawWei === null || (repayWei === 0n && withdrawWei === 0n)) return null;
    return () => planRepayAndWithdraw({ market: selected.market, positionId: selected.info.positionId, userAddress: wallet.address!, repayAmount: repayWei, withdrawAmount: withdrawWei, withdrawTokenAddress: tokenAddress(token) });
  }, [deposit, market, mint, mode, repay, selected, selectedKey, token, wallet.address, withdraw]);

  return (
    <AppShell title="Borrow" subtitle="Deposit collateral and mint fxUSD, or repay debt and withdraw it through the official SDK.">
      <div className="stagger flex flex-col gap-3.5">
        <Card glow className="p-5"><div className="flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint"><Banknote className="h-5 w-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-mint">fxUSD borrowing</p><h2 className="text-display mt-1 text-[22px] font-semibold">Protocol-native collateral</h2><p className="mt-1 text-[11px] leading-relaxed text-mut">Only live position data from ETH/BTC long pools is shown. Debt and collateral values come from the SDK.</p></div></div></Card>
        {!wallet.address ? <WalletConnectCTA ready={wallet.ready} authenticated={wallet.authenticated} body="Choose or connect a wallet to read live collateral and debt before preparing an fxUSD action." /> : loading && !positions.length && mode === 'manage' ? <LoadingRegion label="Reading borrowing positions" className="flex flex-col gap-3.5"><Skeleton className="h-12" /><Skeleton className="h-40" /></LoadingRegion> : error ? <EmptyState icon={RefreshCw} title="Borrowing state unavailable" body={error} action={<Button onClick={() => void load()}>Retry</Button>} /> : <>
          <Segmented value={mode} onChange={(next) => { setMode(next); setSelectedKey(next === 'mint' ? 'new' : positions[0] ? positionKey(positions[0]) : ''); setRepay(''); setWithdraw(''); }} ariaLabel="Borrow action" options={[{ value: 'mint', label: 'Deposit & mint' }, { value: 'manage', label: 'Repay & withdraw' }]} />
          {mode === 'manage' && !positions.length ? <EmptyState icon={Coins} title="No long positions" body="Open a long position or create a collateral position here before repaying or withdrawing." /> : <Card className="p-4"><div className="flex flex-col gap-4">
            {mode === 'mint' ? <><Segmented value={market} onChange={(next) => { setMarket(next); setSelectedKey('new'); setToken(next === 'ETH' ? 'ETH' : 'WBTC'); }} ariaLabel="Collateral market" options={[{ value: 'ETH', label: 'ETH market' }, { value: 'BTC', label: 'BTC market' }]} /><PositionSelect value={selectedKey} positions={positions.filter((position) => position.market === market)} allowNew onChange={setSelectedKey} /><TokenSelect label="Collateral token" value={token} options={collateralTokens} onChange={setToken} /><AmountField label="Collateral amount" symbol={token} value={deposit} onChange={setDeposit} allowZero maxDecimals={tokenDecimals(token)} placeholder="0 for mint only" /><AmountField label="fxUSD to mint" symbol="fxUSD" value={mint} onChange={setMint} allowZero maxDecimals={18} placeholder="0 for deposit only" /><InfoNote>Deposit and mint is one official SDK capability. The SDK decides the protocol calldata and ordered approvals.</InfoNote></> : <><PositionSelect value={selectedKey} positions={positions} onChange={setSelectedKey} />{selected && <div className="grid grid-cols-2 gap-2"><Metric label="Collateral" value={`${formatAmount(selected.info.rawColls, positionCollateralDecimals(selected))} ${selected.info.rawCollsToken}`} /><Metric label="Debt" value={`${formatAmount(selected.info.rawDebts, positionDebtDecimals(selected))} ${selected.info.rawDebtsToken}`} /></div>}<AmountField label="Repay amount" symbol="fxUSD" value={repay} onChange={setRepay} allowAll allowZero maxDecimals={18} /><TokenSelect label="Withdraw collateral as" value={token} options={selected?.market === 'BTC' ? BTC_MARKET_TOKENS.filter((item) => item === 'WBTC') : ETH_MARKET_TOKENS.filter((item) => !['USDC', 'USDT', 'fxUSD'].includes(item))} onChange={setToken} /><AmountField label="Collateral to withdraw" symbol={token} value={withdraw} onChange={setWithdraw} allowZero maxDecimals={tokenDecimals(token)} placeholder="0 for repay only" /><InfoNote>Use repay-only, withdraw-only, or both. “all” resolves to the live SDK debt immediately before planning.</InfoNote></>}
          </div></Card>}
          <ActionReview planBuilder={planBuilder} label={mode === 'mint' ? 'Review deposit & mint' : 'Review repay & withdraw'} operationLabel={mode === 'mint' ? 'Deposit collateral and mint fxUSD' : 'Repay fxUSD and withdraw collateral'} onComplete={load} />
        </>}
      </div>
    </AppShell>
  );
}

function PositionSelect({ value, positions, allowNew = false, onChange }: { value: string; positions: UiPosition[]; allowNew?: boolean; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.15em] text-mut">Position</span><select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-14 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-[13px] font-semibold outline-none focus:border-[rgba(139,109,255,.5)]">{allowNew && <option value="new">New collateral position</option>}{positions.map((position) => <option key={positionKey(position)} value={positionKey(position)}>#{position.info.positionId} · {position.market} · {formatAmount(position.info.rawColls, positionCollateralDecimals(position))} collateral</option>)}</select></label>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-[rgba(255,255,255,.035)] p-3"><span className="block text-[9px] uppercase tracking-[0.1em] text-mut">{label}</span><span className="mt-1 block truncate text-[12px] font-semibold">{value}</span></div>; }
