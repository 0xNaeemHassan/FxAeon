import type { ReactNode } from 'react';

export type MissingValueWidth = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type MissingValueStatus = 'loading' | 'unavailable';

export type MissingValueProps = {
  width?: MissingValueWidth;
  status?: MissingValueStatus;
  loading?: boolean;
  label?: string;
  className?: string;
};

/**
 * A stable inline placeholder for values that have not been verified yet.
 * The fixed width keeps metric rows from shifting as reads settle.
 */
export function MissingValue({
  width = 'md',
  status,
  loading,
  label,
  className = '',
}: MissingValueProps) {
  const unavailable = status ? status === 'unavailable' : loading === false;
  const accessibleLabel = label ?? (unavailable ? 'Value unavailable' : 'Loading value');
  return (
    <span
      role="status"
      aria-label={accessibleLabel}
      className={`missing-value missing-value-${width}${unavailable ? ' missing-value-unavailable' : ''} ${className}`.trim()}
    >
      <span className="missing-value-bar" aria-hidden="true" />
    </span>
  );
}

export type ValueOrSkeletonProps = MissingValueProps & {
  value?: ReactNode;
  children?: ReactNode;
};

/** Replace only exact display sentinels; formatted values and composed nodes pass through. */
export function ValueOrSkeleton({ value, children, ...placeholderProps }: ValueOrSkeletonProps) {
  const content = value ?? children;
  const isMissing = typeof content === 'string' && (content === '—' || content === '-');
  return isMissing ? <MissingValue {...placeholderProps} /> : <>{content}</>;
}
