import type { CSSProperties } from 'react';
import styles from './RollingFigure.module.css';

/**
 * A figure whose digits roll to their new values when it changes. Every
 * visible glyph is CSS-generated, so the element's text stays exactly the
 * formatted string (one visually hidden copy) for tests, copy, and screen
 * readers. Glyph identity is counted from the right, so a value gaining a
 * digit rolls the existing ones instead of remounting them.
 */
export function RollingFigure({ value, className = '', fractionClassName }: { value: string; className?: string; fractionClassName?: string }) {
  const chars = [...value];
  const decimalAt = value.lastIndexOf('.');
  return <span className={`${styles.figure} ${className}`.trim()}>
    <span className={styles.text}>{value}</span>
    <span className={styles.glyphs} aria-hidden="true">
      {chars.map((char, index) => {
        const fromRight = chars.length - index;
        const fraction = fractionClassName && decimalAt >= 0 && index >= decimalAt ? fractionClassName : '';
        return /\d/.test(char)
          ? <span key={`d${fromRight}`} className={`${styles.glyph} ${styles.digit} ${fraction}`.trim()} style={{ '--d': Number(char) } as CSSProperties} />
          : <span key={`c${fromRight}:${char}`} className={`${styles.glyph} ${styles.char} ${fraction}`.trim()} data-char={char} />;
      })}
    </span>
  </span>;
}
