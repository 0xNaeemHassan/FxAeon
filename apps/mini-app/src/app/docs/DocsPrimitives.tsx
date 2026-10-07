import type { ReactNode } from 'react';
import styles from './Docs.module.css';

export { default as CodeBlock } from './CodeBlock';

export function DocSection({ id, title, aliases = [], children }: { id: string; title: string; aliases?: readonly string[]; children: ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-heading`}>
      {aliases.map((alias) => <span key={alias} id={alias} aria-hidden="true" />)}
      <h2 id={`${id}-heading`} tabIndex={-1}>
        <a href={`#${id}`} className={styles.headingLink}>
          {title}<span className={styles.anchorMark} aria-hidden="true">#</span>
        </a>
      </h2>
      {children}
    </section>
  );
}

export function Callout({ title, children }: { title?: string; children: ReactNode }) {
  return <aside className={styles.callout}>{title && <strong>{title}</strong>}{children}</aside>;
}
