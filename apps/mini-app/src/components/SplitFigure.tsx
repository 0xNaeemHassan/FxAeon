import styles from './SplitFigure.module.css';

/**
 * A formatted figure whose fractional part recedes so whole units lead. The
 * text content stays the exact formatted string.
 */
export function SplitFigure({ value }: { value: string }) {
  const match = /^(.*?)(\.\d+)?$/.exec(value);
  return <>{match?.[1] ?? value}{match?.[2] && <span className={styles.fraction}>{match[2]}</span>}</>;
}
