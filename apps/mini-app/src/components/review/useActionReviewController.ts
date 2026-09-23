'use client';

import { useCallback, useState } from 'react';
import type { PlannedRoute } from '@/lib/fx';
import { acceptedRouteTerms, canAcceptReviewedRoute, reviewSessionMismatch, transitionReviewStage, type ReviewSession, type ReviewStage, type ReviewTransition } from './actionReviewModel';

/** Owns the accepted route identity and review-stage lifecycle independently of the view. */
export function useActionReviewController() {
  const [stage, setStage] = useState<ReviewStage>('input');
  const [acceptedTerms, setAcceptedTerms] = useState<string | null>(null);
  const [acceptedIntentKey, setAcceptedIntentKey] = useState<string | (() => Promise<PlannedRoute | readonly PlannedRoute[]>) | null>(null);
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null);
  const [quoteExpired, setQuoteExpired] = useState(false);

  const transition = useCallback((event: ReviewTransition, walletPending = false) => {
    setStage((current) => transitionReviewStage(current, event, walletPending));
  }, []);
  const acceptRoute = useCallback((route: PlannedRoute, intentKey: string | (() => Promise<PlannedRoute | readonly PlannedRoute[]>) | null, walletPending = false) => {
    if (!canAcceptReviewedRoute(stage, walletPending)) return false;
    setAcceptedTerms(acceptedRouteTerms(route));
    setAcceptedIntentKey(() => intentKey);
    setQuoteExpired(false);
    return true;
  }, [stage]);
  const bindSession = useCallback((session: ReviewSession) => setReviewSession(session), []);
  const clearSession = useCallback(() => setReviewSession(null), []);
  const sessionMismatch = useCallback((live: ReviewSession & { authenticated: boolean }) => (
    reviewSession ? reviewSessionMismatch(reviewSession, live) : null
  ), [reviewSession]);
  const checkSession = useCallback((expected: ReviewSession, live: ReviewSession & { authenticated: boolean }) => reviewSessionMismatch(expected, live), []);
  const matchesAcceptedRoute = useCallback((route: PlannedRoute, intentKey: typeof acceptedIntentKey) => (
    acceptedTerms !== null && acceptedTerms === acceptedRouteTerms(route) && acceptedIntentKey === intentKey
  ), [acceptedIntentKey, acceptedTerms]);
  const expireQuote = useCallback(() => setQuoteExpired(true), []);
  const clearAcceptedRoute = useCallback(() => {
    setAcceptedTerms(null);
    setAcceptedIntentKey(null);
    setQuoteExpired(false);
    setReviewSession(null);
  }, []);
  return { stage, setStage, transition, acceptedTerms, acceptedIntentKey, acceptRoute, matchesAcceptedRoute, bindSession, clearSession, reviewSession, sessionMismatch, checkSession, expireQuote, clearAcceptedRoute, quoteExpired };
}
