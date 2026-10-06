'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import styles from './PageSections.module.css';

/**
 * The part of a page after its main action: live facts, how the action works,
 * and the questions people ask. Sections rise into view once as they are
 * scrolled to; reduced motion shows them in place.
 */
export function PageSections({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.sections} aria-label={label} role="region">{children}</div>;
}

export function Section({ id, eyebrow, title, action, children }: {
  id: string;
  eyebrow?: string;
  title: string;
  action?: { label: string; href: string; external?: boolean };
  children: ReactNode;
}) {
  return <Reveal>
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHead}>
        <div>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        {action && (action.external
          ? <a className={styles.sectionAction} href={action.href} target="_blank" rel="noopener noreferrer">{action.label}<ArrowUpRight aria-hidden="true" /></a>
          : <Link className={styles.sectionAction} href={action.href}>{action.label}<ChevronRight aria-hidden="true" /></Link>)}
      </header>
      {children}
    </section>
  </Reveal>;
}

export type Stat = { label: string; value: ReactNode; hint?: ReactNode };

/** Facts that matter before acting, each a quiet tile: label, figure, one line of context. */
export function StatGrid({ stats }: { stats: readonly Stat[] }) {
  return <dl className={styles.stats}>
    {stats.map((stat) => <div key={stat.label} className={styles.stat}>
      <dt>{stat.label}</dt>
      <dd>{stat.value}</dd>
      {stat.hint && <dd className={styles.statHint}>{stat.hint}</dd>}
    </div>)}
  </dl>;
}

export type Step = { icon: LucideIcon; title: string; body: ReactNode };

/** How an action works, as a numbered path; a rule connects the steps on phones. */
export function Steps({ steps }: { steps: readonly Step[] }) {
  return <ol className={styles.steps}>
    {steps.map(({ icon: Icon, title, body }, index) => <li key={title} className={styles.step} style={{ '--step': index } as CSSProperties}>
      <span className={styles.stepIcon} aria-hidden="true"><Icon /></span>
      <div>
        <p className={styles.stepIndex}>Step {index + 1}</p>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </li>)}
  </ol>;
}

export type Question = { question: string; answer: ReactNode };

/** The questions people ask before acting, each opening in place. */
export function Questions({ items }: { items: readonly Question[] }) {
  return <div className={styles.questions}>
    {items.map((item) => <details key={item.question} className={styles.question}>
      <summary>
        <span>{item.question}</span>
        <ChevronDown className="disclosure-chevron" aria-hidden="true" />
      </summary>
      <div className={styles.answer}>{item.answer}</div>
    </details>)}
  </div>;
}

/** A note that matters (risk, limits) set apart from the facts. */
export function Callout({ icon: Icon, title, children, link }: { icon: LucideIcon; title: string; children: ReactNode; link?: { label: string; href: string } }) {
  return <div className={styles.callout}>
    <span className={styles.calloutIcon} aria-hidden="true"><Icon /></span>
    <div>
      <h3>{title}</h3>
      <p>{children}</p>
      {link && <a href={link.href} target="_blank" rel="noopener noreferrer" className={styles.calloutLink}>{link.label}<ArrowUpRight aria-hidden="true" /></a>}
    </div>
  </div>;
}

/** Rises into place the first time it scrolls into view. */
function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); observer.disconnect(); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);
  return <div ref={ref} className={styles.reveal} data-shown={shown || undefined}>{children}</div>;
}
