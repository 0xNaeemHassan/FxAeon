import type { ReactNode } from 'react';
import type { PlannedRoute, TransactionExecutionResult } from '@/lib/fx';
import type { SignatureDraftState } from '@/lib/fx';
import type { ReviewFact } from '@/lib/fx/reviewFormatting';

export type ActionPlanBuilder = () => Promise<PlannedRoute | readonly PlannedRoute[]>;
export type ActionReviewStage = 'input' | 'planning' | 'review' | 'executing' | 'result';

export interface ActionReviewProps {
  /** Build the route for initial preview, background refresh, and explicit review. */
  planBuilder: ActionPlanBuilder | null;
  /** Read a short-lived prepared route for the current form intent. */
  prefetchedPlan?: () => Promise<PlannedRoute | readonly PlannedRoute[] | null>;
  label?: string;
  disabled?: boolean;
  /** Runs after verified receipts and confirmation; reads may still be settling. */
  onComplete?: (result: TransactionExecutionResult, confirmedRoute: PlannedRoute) => void | Promise<void>;
  operationLabel?: string;
  destructive?: boolean;
  onStageChange?: (stage: ActionReviewStage) => void;
  draftState?: SignatureDraftState;
  draftActionKey?: string;
  draftResumePath?: string;
  resumeReview?: number;
  editor?: ReactNode;
  reviewBeforeSign?: boolean;
  surface?: 'card' | 'content';
  decisionBefore?: ReviewFact[];
  executionCost?: {
    estimatedGas?: string;
    gasFee?: string;
    protocolFee?: string;
    totalCost?: string;
  };
}
