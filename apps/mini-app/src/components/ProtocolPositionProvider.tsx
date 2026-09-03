'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createPositionReadGuard,
  mergeVerifiedPositions,
  newlyVerifiedPositions,
  positionKey,
  readAllPositionsDetailed,
  unavailablePositionResult,
  type PositionGroupFailure,
  type PositionGroup,
  type PositionReadResult,
  type UiPosition,
} from '@/app/trade/fxUi';
import { usePrivyWallet } from '@/lib/wallet';
import { deriveConfirmedPositionHint, readConfirmedPosition, verifyConfirmedPositionHint, type ConfirmedPositionHint } from '@/lib/confirmedPositions';
import { confirmedPositionHintKey, confirmedPositionStorageKey, parseStoredPositionHints, savePositionHints, type StoredPositionHint } from '@/lib/confirmedPositionStorage';
import type { PlannedRoute, TransactionExecutionResult } from '@/lib/fx';

export type ProtocolPositionStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';

export interface ProtocolPositionRefreshResult extends PositionReadResult {
  newPositions: UiPosition[];
}

interface ProtocolPositionSnapshot {
  walletAddress: string | null;
  positions: UiPosition[];
  status: ProtocolPositionStatus;
  failedGroups: PositionGroupFailure[];
  lastVerifiedAt: number | null;
  refreshing: boolean;
  verifiedGroups: PositionGroup[];
}

export interface ProtocolPositionContextValue extends ProtocolPositionSnapshot {
  refresh: () => Promise<ProtocolPositionRefreshResult>;
  pendingPositions: ConfirmedPositionHint[];
  checkingConfirmedPositions: boolean;
  refreshConfirmedPositions: () => Promise<void>;
  trackConfirmedPosition: (execution: TransactionExecutionResult, route: PlannedRoute) => Promise<boolean>;
}

const EMPTY_RESULT: ProtocolPositionRefreshResult = {
  positions: [],
  successfulGroups: [],
  failedGroups: [],
  status: 'unavailable',
  newPositions: [],
};

function emptySnapshot(walletAddress: string | null = null): ProtocolPositionSnapshot {
  return {
    walletAddress,
    positions: [],
    status: walletAddress ? 'loading' : 'idle',
    failedGroups: [],
    lastVerifiedAt: null,
    refreshing: false,
    verifiedGroups: [],
  };
}

const ProtocolPositionContext = createContext<ProtocolPositionContextValue | null>(null);

export default function ProtocolPositionProvider({ children }: { children: ReactNode }) {
  const wallet = usePrivyWallet();
  const address = wallet.ready && wallet.authenticated ? wallet.address?.toLowerCase() ?? null : null;

  // A keyed session removes the prior account's snapshot and in-flight forms
  // synchronously, before effects run for the next wallet. No frame may pair
  // one wallet's address with another wallet's positions or balances.
  return <ProtocolPositionSession key={address ?? 'disconnected'} address={address}>{children}</ProtocolPositionSession>;
}

function ProtocolPositionSession({ address, children }: { address: string | null; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ProtocolPositionSnapshot>(() => emptySnapshot(address));
  const snapshotRef = useRef(snapshot);
  const readGuardRef = useRef(createPositionReadGuard());
  const [pendingPositions, setPendingPositions] = useState<ConfirmedPositionHint[]>([]);
  const [checkingConfirmedPositions, setCheckingConfirmedPositions] = useState(false);
  const hintRecords = useRef<StoredPositionHint[]>([]);
  const sessionGeneration = useRef(0);
  const sessionActive = useRef(false);
  const hintRead = useRef<number | null>(null);
  const hintSequence = useRef(0);
  const fullRefreshRef = useRef<((wallet: string) => Promise<ProtocolPositionRefreshResult>) | null>(null);

  const commit = useCallback((next: ProtocolPositionSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const persistHints = useCallback(() => {
    if (!address) return;
    try { savePositionHints(window.localStorage, address, hintRecords.current); } catch { /* Private browsing. */ }
  }, [address]);

  const removeHint = useCallback((key: string) => {
    hintRecords.current = hintRecords.current.filter(({ hint }) => confirmedPositionHintKey(hint) !== key);
    setPendingPositions((items) => items.filter((hint) => confirmedPositionHintKey(hint) !== key));
    persistHints();
  }, [persistHints]);

  const refreshConfirmedPositions = useCallback(async () => {
    if (!address || !sessionActive.current || hintRead.current !== null || !hintRecords.current.length) return;
    const generation = sessionGeneration.current;
    const batch = ++hintSequence.current;
    hintRead.current = batch;
    setCheckingConfirmedPositions(true);
    const isCurrent = () => sessionActive.current && sessionGeneration.current === generation && hintRead.current === batch;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const reads = Promise.all(hintRecords.current.map(async ({ hint }) => {
        const key = confirmedPositionHintKey(hint);
        const hintIsCurrent = () => isCurrent() && hintRecords.current.some((item) => confirmedPositionHintKey(item.hint) === key && item.hint.transactionHash === hint.transactionHash);
        try {
          const verified = await verifyConfirmedPositionHint(hint, address);
          if (!hintIsCurrent()) return;
          if (!verified) { removeHint(key); return; }
          if (snapshotRef.current.positions.some((position) => positionKey(position) === key)) { removeHint(key); return; }
          setPendingPositions((items) => items.some((item) => confirmedPositionHintKey(item) === key) ? items : [...items, hint]);
          const position = await readConfirmedPosition(hint, address);
          if (!hintIsCurrent() || !position) return;
          // Supersede any older all-market request; it may have captured an
          // empty index before this exact, receipt-bound position was visible.
          readGuardRef.current.begin();
          const current = snapshotRef.current;
          commit({ ...current, positions: [...current.positions.filter((item) => positionKey(item) !== key), position],
            // One verified position improves unavailable/loading to partial,
            // but cannot establish freshness for the rest of its pool group.
            status: current.status === 'loading' || current.status === 'unavailable' ? 'partial' : current.status, refreshing: false });
          removeHint(key);
          void fullRefreshRef.current?.(address);
        } catch {
          // An unavailable RPC/index is not evidence the successful trade failed.
          // Keep only previously verified hints visible; restored hints stay hidden.
        }
      }));
      // A hung indexer must not permanently lock every manual retry. The batch
      // token also prevents late responses from a timed-out batch changing state.
      await Promise.race([reads, new Promise<void>((resolve) => { deadline = setTimeout(resolve, 25_000); })]);
    } finally {
      if (deadline) clearTimeout(deadline);
      if (isCurrent()) { hintRead.current = null; setCheckingConfirmedPositions(false); }
    }
  }, [address, commit, removeHint]);

  const trackConfirmedPosition = useCallback(async (execution: TransactionExecutionResult, route: PlannedRoute) => {
    if (!address || !sessionActive.current) return false;
    const generation = sessionGeneration.current;
    const hint = deriveConfirmedPositionHint({ route, result: execution, walletAddress: address });
    if (!hint) return false;
    const key = confirmedPositionHintKey(hint);
    // Preserve the receipt-derived discovery hint even if the next RPC read is
    // unavailable. It stays hidden until refresh verifies ownership and receipt.
    hintRecords.current = [...hintRecords.current.filter((item) => confirmedPositionHintKey(item.hint) !== key), { hint, addedAt: Date.now() }].slice(-12);
    persistHints();
    const retainedKeys = new Set(hintRecords.current.map((item) => confirmedPositionHintKey(item.hint)));
    setPendingPositions((items) => items.filter((item) => retainedKeys.has(confirmedPositionHintKey(item))));
    if (generation !== sessionGeneration.current) return false;
    // Do not hold the confirmed transaction screen open while the index catches up.
    void refreshConfirmedPositions();
    return true;
  }, [address, persistHints, refreshConfirmedPositions]);

  const loadAddress = useCallback(async (walletAddress: string): Promise<ProtocolPositionRefreshResult> => {
    const requestId = readGuardRef.current.begin();
    if (requestId === null) return EMPTY_RESULT;
    const current = snapshotRef.current.walletAddress?.toLowerCase() === walletAddress.toLowerCase()
      ? snapshotRef.current
      : emptySnapshot(walletAddress);

    commit({
      ...current,
      walletAddress,
      status: current.lastVerifiedAt === null ? 'loading' : current.status,
      refreshing: current.lastVerifiedAt !== null,
    });

    try {
      const result = await readAllPositionsDetailed(walletAddress);
      if (!readGuardRef.current.isCurrent(requestId)) return EMPTY_RESULT;

      const merged = mergeVerifiedPositions(current.positions, result);
      // Only call an ID newly minted when its group had a verified baseline
      // immediately before this refresh. A recovered pool may reveal older
      // positions and must not be presented as a just-confirmed transaction.
      const newPositions = current.lastVerifiedAt === null
        ? []
        : newlyVerifiedPositions(current.positions, result, current.verifiedGroups);
      commit({
        walletAddress,
        positions: merged,
        status: result.status,
        failedGroups: result.failedGroups,
        lastVerifiedAt: result.successfulGroups.length > 0 ? Date.now() : current.lastVerifiedAt,
        refreshing: false,
        verifiedGroups: result.successfulGroups,
      });
      return { ...result, newPositions };
    } catch (reason) {
      if (readGuardRef.current.isCurrent(requestId)) {
        const result = unavailablePositionResult(reason);
        commit({
          ...current,
          walletAddress,
          status: 'unavailable',
          failedGroups: result.failedGroups,
          refreshing: false,
          verifiedGroups: [],
        });
      }
      return EMPTY_RESULT;
    }
  }, [commit]);

  fullRefreshRef.current = loadAddress;

  useEffect(() => {
    const guard = readGuardRef.current;
    guard.activate();
    sessionActive.current = true;
    sessionGeneration.current += 1;
    hintRead.current = null;
    if (address) {
      try { hintRecords.current = parseStoredPositionHints(window.localStorage.getItem(confirmedPositionStorageKey(address)), address); } catch { hintRecords.current = []; }
      void refreshConfirmedPositions();
    }
    if (address) void loadAddress(address);
    // Bounded foreground polling covers ordinary index lag. Afterwards, focus
    // or the explicit refresh button retries without indefinite background RPCs.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && hintRecords.current.some((record) => Date.now() - record.addedAt < 90_000)) void refreshConfirmedPositions();
    }, 5_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshConfirmedPositions(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      guard.invalidate();
      sessionActive.current = false;
      sessionGeneration.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [address, loadAddress, refreshConfirmedPositions]);

  const refresh = useCallback(async () => {
    if (!address) return EMPTY_RESULT;
    void refreshConfirmedPositions();
    return loadAddress(address);
  }, [address, loadAddress, refreshConfirmedPositions]);

  const value = useMemo<ProtocolPositionContextValue>(() => ({ ...snapshot, refresh,
    pendingPositions: pendingPositions.filter((hint) => !snapshot.positions.some((position) => positionKey(position) === confirmedPositionHintKey(hint))),
    checkingConfirmedPositions, refreshConfirmedPositions, trackConfirmedPosition,
  }), [refresh, snapshot, pendingPositions, checkingConfirmedPositions, refreshConfirmedPositions, trackConfirmedPosition]);
  return <ProtocolPositionContext.Provider value={value}>{children}</ProtocolPositionContext.Provider>;
}

export function useProtocolPositions(): ProtocolPositionContextValue {
  const value = useContext(ProtocolPositionContext);
  if (!value) throw new Error('useProtocolPositions must be used inside ProtocolPositionProvider');
  return value;
}
