import { AlertTriangle, CheckCircle2, CircleAlert, Clock3, XCircle, type LucideIcon } from 'lucide-react';
import type { TransactionExecutionResult } from '@/lib/fx';
import { userSafeError } from '@/lib/errors';
import { hasTransactionHash, transactionStepProgress } from '@/lib/transactionProgress';

function looksLikeWalletRejection(value: string | undefined): boolean {
  return Boolean(value && /(reject|denied|declin|cancel(?:led|ed)|user refused|user denied)/i.test(value));
}

export function resultPresentation(result: TransactionExecutionResult, bridge: boolean): {
  title: string;
  body: string;
  tone: 'success' | 'warning' | 'danger';
  icon: LucideIcon;
} {
  const submitted = result.steps.filter(hasTransactionHash);
  const confirmationUnknown = submitted.some((step) => step.hash && !step.receipt);
  const verificationIncomplete = submitted.some((step) => transactionStepProgress(step).state === 'unverified');
  const finalityPending = submitted.some((step) => step.receipt?.status === 'success' && step.status !== 'confirmed');
  const reverted = result.steps.some((step) => step.receipt?.status === 'reverted');
  if (result.status === 'confirmed') {
    return bridge
      ? { title: 'Confirmed on source', body: 'The source route is confirmed. Destination delivery is verified separately below.', tone: 'success', icon: CheckCircle2 }
      : { title: 'Confirmed', body: `All transaction steps are confirmed on ${result.chainId === 8453 ? 'Base' : result.chainId === 1 ? 'Ethereum' : `Chain ${result.chainId}`}.`, tone: 'success', icon: CheckCircle2 };
  }
  if (confirmationUnknown) return { title: 'Confirmation unknown', body: 'A transaction was submitted, but its receipt could not be verified. Check the explorer or Activity from the wallet profile. Do not submit this action again.', tone: 'warning', icon: Clock3 };
  if (verificationIncomplete) return { title: 'Verification incomplete', body: 'A receipt exists, but the submitted transaction could not be fully verified. Check the explorer or Activity. Do not submit this action again.', tone: 'warning', icon: AlertTriangle };
  if (finalityPending) return { title: 'Confirmation pending', body: 'A transaction was included, but finality could not be verified yet. Check Activity or the explorer and do not submit this action again.', tone: 'warning', icon: Clock3 };
  if (result.status === 'partial') return { title: 'Partially completed', body: 'At least one earlier transaction confirmed before the route stopped. Do not repeat the full action; review each step below.', tone: 'warning', icon: AlertTriangle };
  if (reverted) return { title: 'Reverted', body: 'The submitted transaction reverted on-chain. No later step was submitted.', tone: 'danger', icon: XCircle };
  if (looksLikeWalletRejection(result.error)) return { title: 'Wallet request declined', body: 'This transaction was not submitted. No later step was opened.', tone: 'danger', icon: XCircle };
  return { title: 'Not submitted', body: userSafeError(result.error, 'The route stopped before a transaction could be confirmed.'), tone: 'danger', icon: CircleAlert };
}
