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
  readAllPositionsDetailed,
  unavailablePositionResult,
  type PositionGroupFailure,
  type PositionGroup,
  type PositionReadResult,
  type UiPosition,
} from '@/app/trade/fxUi';
import { usePrivyWallet } from '@/lib/wallet';

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

  const commit = useCallback((next: ProtocolPositionSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

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

  useEffect(() => {
    const guard = readGuardRef.current;
    guard.activate();
    if (address) void loadAddress(address);
    return () => {
      guard.invalidate();
    };
  }, [address, loadAddress]);

  const refresh = useCallback(async () => {
    if (!address) return EMPTY_RESULT;
    return loadAddress(address);
  }, [address, loadAddress]);

  const value = useMemo<ProtocolPositionContextValue>(() => ({ ...snapshot, refresh }), [refresh, snapshot]);
  return <ProtocolPositionContext.Provider value={value}>{children}</ProtocolPositionContext.Provider>;
}

export function useProtocolPositions(): ProtocolPositionContextValue {
  const value = useContext(ProtocolPositionContext);
  if (!value) throw new Error('useProtocolPositions must be used inside ProtocolPositionProvider');
  return value;
}
