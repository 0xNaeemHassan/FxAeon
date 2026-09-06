'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createWalletDemandRegistry,
  type WalletDemand,
  type WalletDemandRegistration,
  type WalletDemandRegistry,
  isWalletProfileOpenForRoute,
} from '@/lib/walletDemand';

type WalletDemandContextValue = {
  demand: WalletDemand;
  register: (demand: WalletDemandRegistration) => () => void;
  walletProfileAddress: string | null;
  setWalletProfileAddress: (address: string | null) => void;
};

const WalletDemandContext = createContext<WalletDemandContextValue | null>(null);

export default function WalletDemandProvider({ routeDemand, routeKey, children }: { routeDemand: WalletDemand; routeKey: string; children: ReactNode }) {
  const registryRef = useRef<WalletDemandRegistry | null>(null);
  if (!registryRef.current) registryRef.current = createWalletDemandRegistry(routeDemand);
  registryRef.current.setRouteDemand(routeDemand);
  const [, setRevision] = useState(0);
  const [profile, setProfile] = useState<{ address: string; routeKey: string } | null>(null);
  const register = useCallback((demand: WalletDemandRegistration) => {
    const unregister = registryRef.current!.register(demand);
    setRevision((value) => value + 1);
    return () => {
      unregister();
      setRevision((value) => value + 1);
    };
  }, []);
  const setWalletProfileAddress = useCallback((address: string | null) => {
    setProfile(address ? { address: address.toLowerCase(), routeKey } : null);
  }, [routeKey]);
  // Route changes must synchronously hide an old drawer, while a demand
  // change caused by opening the drawer must retain it across the position
  // provider's enable transition. Associate the open state with its pathname
  // to distinguish those two cases without global UI state.
  const walletProfileAddress = isWalletProfileOpenForRoute(profile, profile?.address, routeKey) ? profile!.address : null;
  const value: WalletDemandContextValue = { demand: registryRef.current!.getDemand(), register, walletProfileAddress, setWalletProfileAddress };
  return <WalletDemandContext.Provider value={value}>{children}</WalletDemandContext.Provider>;
}

export function useWalletDemand(demand: WalletDemandRegistration, active: boolean): void {
  const context = useContext(WalletDemandContext);
  if (!context) throw new Error('useWalletDemand must be used inside WalletDemandProvider');
  const { register } = context;
  useEffect(() => {
    if (!active) return undefined;
    return register(demand);
  }, [active, demand, register]);
}

export function useEffectiveWalletDemand(): WalletDemand {
  const context = useContext(WalletDemandContext);
  if (!context) throw new Error('useEffectiveWalletDemand must be used inside WalletDemandProvider');
  return context.demand;
}

export function useWalletProfileSession(): Pick<WalletDemandContextValue, 'walletProfileAddress' | 'setWalletProfileAddress'> {
  const context = useContext(WalletDemandContext);
  if (!context) throw new Error('useWalletProfileSession must be used inside WalletDemandProvider');
  return context;
}
