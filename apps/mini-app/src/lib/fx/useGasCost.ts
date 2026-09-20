'use client';

import { useEffect, useRef, useState } from 'react';
import type { FxPublicClient, PlannedRoute } from './types';
import {
  routeGasCostCache,
  routeGasCostKey,
  safeGasCostError,
  type GasCostCacheView,
  type RouteGasCostEstimate,
} from './gasCost';

export interface UseGasCostOptions {
  enabled?: boolean;
  client?: FxPublicClient;
  /** Refresh at most once per cache TTL while this route remains mounted. */
  refresh?: boolean;
}

export interface UseGasCostResult extends GasCostCacheView {
  /** Current estimate when available, otherwise the retained prior snapshot. */
  estimate?: RouteGasCostEstimate;
  /** Whether `estimate` is fresh enough to be used as a current review fact. */
  estimateIsCurrent: boolean;
  error?: string;
}

const EMPTY_VIEW: GasCostCacheView = { status: 'unavailable' };

/**
 * Route-scoped React adapter. The effect is cancellable on route/account/chain
 * changes. A stale result can remain visible through `estimate`, while
 * `estimateIsCurrent` stays false until the new RPC snapshot completes.
 */
export function useRouteGasCost(
  route: PlannedRoute | null | undefined,
  options: UseGasCostOptions = {},
): UseGasCostResult {
  const enabled = options.enabled ?? true;
  const refresh = options.refresh ?? true;
  const routeKey = route ? routeGasCostKey(route) : '';
  const [state, setState] = useState<{ key: string; view: GasCostCacheView }>({ key: '', view: EMPTY_VIEW });
  const [errorState, setErrorState] = useState<{ key: string; value?: string }>({ key: '' });
  const routeRef = useRef(route);
  routeRef.current = route;
  // React effects run after paint. Keying the state prevents a previous
  // account/chain/route estimate from flashing as current for the new route.
  const keyedView = enabled && state.key === routeKey ? state.view : EMPTY_VIEW;
  // A parent render after TTL expiry must not present the expired value as a
  // current review fact, even when this hook is configured with refresh=false.
  const expiredCurrent = keyedView.current && keyedView.current.validUntil <= Date.now();
  const view: GasCostCacheView = expiredCurrent
    ? { ...keyedView, status: keyedView.status === 'current' ? 'unavailable' : keyedView.status, current: undefined, previous: keyedView.current }
    : keyedView;

  useEffect(() => {
    const activeRoute = routeRef.current;
    if (!activeRoute || !enabled) {
      setState({ key: routeKey, view: EMPTY_VIEW });
      setErrorState({ key: routeKey });
      return;
    }
    const controller = new AbortController();
    const initial = routeGasCostCache.view(activeRoute);
    setState({ key: routeKey, view: initial });
    setErrorState({ key: routeKey });
    if (!refresh) return () => controller.abort();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const scheduleRefresh = (delayMs: number) => {
      clearTimer();
      if (!isOnline() || !isVisible()) return;
      timer = setTimeout(() => { void refreshRoute(); }, Math.max(1, delayMs));
    };
    const refreshRoute = async (): Promise<void> => {
      if (controller.signal.aborted) return;
      if (!isOnline() || !isVisible()) return;
      setState({ key: routeKey, view: routeGasCostCache.view(activeRoute) });
      try {
        await routeGasCostCache.refresh(activeRoute, { client: options.client, signal: controller.signal });
        if (controller.signal.aborted) return;
        const next = routeGasCostCache.view(activeRoute);
        setState({ key: routeKey, view: next });
        setErrorState({ key: routeKey });
        scheduleRefresh(next.current ? Math.max(1, next.current.validUntil - Date.now()) : 15_000);
      } catch (cause: unknown) {
        if (controller.signal.aborted) return;
        setState({ key: routeKey, view: routeGasCostCache.view(activeRoute) });
        setErrorState({ key: routeKey, value: safeGasCostError(cause) });
        scheduleRefresh(15_000);
      }
    };
    if (initial.status === 'current') {
      scheduleRefresh(Math.max(1, (initial.current?.validUntil ?? Date.now()) - Date.now()));
    } else {
      void refreshRoute();
    }
    const onVisibilityOrNetwork = () => {
      if (isOnline() && isVisible()) {
        clearTimer();
        void refreshRoute();
      } else {
        clearTimer();
      }
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityOrNetwork);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onVisibilityOrNetwork);
      window.addEventListener('offline', onVisibilityOrNetwork);
    }
    return () => {
      controller.abort();
      clearTimer();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityOrNetwork);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onVisibilityOrNetwork);
        window.removeEventListener('offline', onVisibilityOrNetwork);
      }
    };
  }, [enabled, options.client, refresh, routeKey]);

  const estimate = view.current ?? view.previous;
  return {
    ...view,
    estimate,
    estimateIsCurrent: Boolean(view.current && view.current.status === 'current' && !view.current.fee?.stale),
    error: enabled && errorState.key === routeKey ? errorState.value : undefined,
  };
}
