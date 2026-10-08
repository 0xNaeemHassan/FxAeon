'use client';

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { openExternalLink } from '@/lib/telegram';
import styles from './PageSections.module.css';

/** Leaves FxAeon through Telegram's own browser in the Mini App, a new tab elsewhere. */
function leaveApp(href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openExternalLink(href)) event.preventDefault();
  };
}

/**
 * The part of a page after its main action: live facts, how the action works,
 * and the questions people ask. Sections rise into view once as they are
 * scrolled to; reduced motion shows them in place.
 */
export function PageSections({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.sections} aria-label={label} role="region">{children}</div>;
}

export function Section({ id, title, action, children }: {
  id: string;
  title: string;
  action?: { label: string; href: string; external?: boolean };
  children: ReactNode;
}) {
  return <Reveal>
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHead}>
        <div>
          <h2 id={`${id}-title`}><LitWords text={title} /></h2>
        </div>
        {action && (action.external
          ? <a className={styles.sectionAction} href={action.href} target="_blank" rel="noopener noreferrer" onClick={leaveApp(action.href)}>{action.label}<ArrowUpRight aria-hidden="true" /></a>
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

/** How an action works, as an ordered path: the list carries the order and a
 * rule connects the steps, so no step needs an eyebrow label. */
export function Steps({ steps }: { steps: readonly Step[] }) {
  return <ol className={styles.steps}>
    {steps.map(({ icon: Icon, title, body }, index) => <li key={title} className={styles.step} style={{ '--step': index } as CSSProperties}>
      <span className={styles.stepIcon} aria-hidden="true"><Icon /></span>
      <div>
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
      {link && <a href={link.href} target="_blank" rel="noopener noreferrer" onClick={leaveApp(link.href)} className={styles.calloutLink}>{link.label}<ArrowUpRight aria-hidden="true" /></a>}
    </div>
  </div>;
}

/**
 * A headline read into light, as on the landing: each word brightens as its
 * line scrolls up to where it is read, and stays lit. Words are spans; the
 * heading's text and accessible name are unchanged. Without script, before
 * hydration, or with reduced motion every word is simply lit.
 */
function LitWords({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const line = ref.current;
    if (!line || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const words = [...line.querySelectorAll<HTMLElement>('[data-word]')];
    const scroller = line.closest<HTMLElement>('[data-shell-content]');
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    let lit = -1;
    const update = () => {
      frame = 0;
      const top = line.getBoundingClientRect().top;
      const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const view = scroller ? scroller.clientHeight : window.innerHeight;
      // Dim while its top is in the lower tenth of the view; fully lit by the middle.
      const progress = Math.min(1, Math.max(0, (view * 0.9 - (top - viewTop)) / (view * 0.42)));
      const count = Math.round(progress * words.length);
      if (count === lit) return;
      lit = count;
      words.forEach((word, index) => word.toggleAttribute('data-lit', index < count));
      if (count === words.length) stop();
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const stop = () => {
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
    line.toggleAttribute('data-lighting', true);
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
    return () => {
      stop();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [text]);
  return <span ref={ref} className={styles.litLine}>{text.split(/(\s+)/).map((part, index) => /^\s+$/.test(part) || !part
    ? part
    : <span key={`${index}:${part}`} data-word className={styles.word}>{part}</span>)}</span>;
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
