'use client';

import { createContext, useContext, useEffect } from 'react';

type AcquirePause = () => () => void;

// Separate from the position provider so standalone reviews need no wallet
// data provider. Each mounted review owns and releases only its own pause.
export const PositionRefreshActivityContext = createContext<AcquirePause | null>(null);

export function usePauseAutomaticPositionRefresh(active: boolean) {
  const acquire = useContext(PositionRefreshActivityContext);
  useEffect(() => {
    if (active && acquire) return acquire();
    return undefined;
  }, [active, acquire]);
}
