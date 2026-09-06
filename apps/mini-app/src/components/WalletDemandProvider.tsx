'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createWalletDemandRegistry,
  type WalletDemand,
  type WalletDemandRegistration,
  type WalletDemandRegistry,
} from '@/lib/walletDemand';

type WalletDemandContextValue = {
  demand: WalletDemand;
  register: (demand: WalletDemandRegistration) => () => void;
};

const WalletDemandContext = createContext<WalletDemandContextValue | null>(null);

export default function WalletDemandProvider({ routeDemand, children }: { routeDemand: WalletDemand; children: ReactNode }) {
  const registryRef = useRef<WalletDemandRegistry | null>(null);
  if (!registryRef.current) registryRef.current = createWalletDemandRegistry(routeDemand);
  registryRef.current.setRouteDemand(routeDemand);
  const [, setRevision] = useState(0);
  const register = useCallback((demand: WalletDemandRegistration) => {
    const unregister = registryRef.current!.register(demand);
    setRevision((value) => value + 1);
    return () => {
      unregister();
      setRevision((value) => value + 1);
    };
  }, []);
  const value: WalletDemandContextValue = { demand: registryRef.current!.getDemand(), register };
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
