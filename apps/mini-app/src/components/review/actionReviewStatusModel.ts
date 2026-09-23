import { confirmedUpdateCopy, transactionStepProgress } from '@/lib/transactionProgress';
import { userSafeError } from '@/lib/errors';
import type { PlanStatus, PlannedRoute, TransactionStepResult } from '@/lib/fx';

type Stage = 'input' | 'planning' | 'review' | 'executing' | 'result';

export function buildStatusPresentation(params: {
  stage: Stage;
  status: PlanStatus;
  detail: string;
  stepResults: readonly TransactionStepResult[];
  stepCount: number;
  operation?: PlannedRoute['operation'];
  refreshing?: boolean;
  networkSwitching?: boolean;
}): { label: string; body: string; className: string; icon: 'clock' | 'loading' | 'success' | 'warning' | 'error' } {
  const confirmed = params.stepResults.filter((step) => transactionStepProgress(step).state === 'confirmed').length;
  const uncertain = params.stepResults.find((step) => ['unknown', 'unverified'].includes(transactionStepProgress(step).state));
  if (uncertain) {
    return {
      label: transactionStepProgress(uncertain).label,
      body: 'Submission is recorded. Check the explorer or History; do not submit this action again.',
      className: 'text-warn',
      icon: 'clock',
    };
  }
  if (params.status === 'planning') {
    return {
      label: params.stage === 'executing' ? 'Preparing wallet request' : 'Preparing transaction',
      body: params.stage === 'executing' ? 'Verifying the latest route.' : 'Building the route.',
      className: 'text-mint',
      icon: 'loading',
    };
  }
  if (params.status === 'reviewing') {
    return params.stage === 'review'
      ? { label: 'Ready to sign', body: 'Review the amount, limits, approvals, and risk above.', className: 'text-success', icon: 'success' }
      : { label: 'Checking transaction', body: 'Verifying the route.', className: 'text-mint', icon: 'loading' };
  }
  if (params.status === 'awaiting-user') {
    if (params.networkSwitching) {
      return {
        label: 'Switching network',
        body: 'Your wallet is switching to the transaction network. Signing opens after the switch is verified.',
        className: 'text-warn',
        icon: 'loading',
      };
    }
    return {
      label: 'Wallet approval',
      body: params.detail ? `${params.detail.replace(/^transaction/i, 'Transaction')}. Review it in your wallet.` : 'Review the transaction in your wallet, then approve it.',
      className: 'text-warn',
      icon: 'clock',
    };
  }
  if (params.status === 'submitted') {
    return {
      label: 'Submitted',
      body: 'Waiting for on-chain confirmation. Track it below or in History; do not submit again.',
      className: 'text-mint',
      icon: 'loading',
    };
  }
  if (params.status === 'included' || params.status === 'confirming') {
    const active = params.stepResults.find((step) => step.status === 'included' || step.status === 'confirming');
    const count = active?.confirmations ?? 0;
    const required = active?.requiredConfirmations ?? 1;
    return {
      label: params.status === 'included' ? 'Included' : `Confirming · ${count}/${required}`,
      body: `Waiting for ${required} confirmation${required === 1 ? '' : 's'} before the next step.`,
      className: 'text-mint',
      icon: 'loading',
    };
  }
  if (params.status === 'confirmed') {
    return confirmed < params.stepCount
      ? { label: 'Step confirmed', body: `${confirmed} of ${params.stepCount} confirmed. Preparing the next transaction.`, className: 'text-success', icon: 'success' }
      : { ...confirmedUpdateCopy(params.operation, params.refreshing ?? false), className: 'text-success', icon: 'success' };
  }
  if (params.status === 'partial' || (params.status === 'failed' && confirmed > 0)) {
    return { label: 'Partially completed', body: 'An earlier step confirmed before the action stopped.', className: 'text-warn', icon: 'warning' };
  }
  return {
    label: 'Action stopped',
    body: userSafeError(params.detail, 'The action could not continue. Check it again before signing.'),
    className: 'text-danger',
    icon: 'error',
  };
}
