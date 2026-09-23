import type { HTMLAttributes, ReactNode } from 'react';
import styles from './ProductLayout.module.css';

type LayoutProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & { children: ReactNode };

function Layout({ recipe, density, children, className = '', ...props }: LayoutProps & { recipe: 'action' | 'portfolio' | 'account'; density?: 'compact' }) {
  const densityClass = density === 'compact' ? styles.compactAction : '';
  return <div {...props} data-product-layout={recipe} className={`${styles.workspace} ${styles[recipe]} ${densityClass} ${className}`}>{children}</div>;
}

/** One dominant decision area followed by compact supporting sections. */
export function ActionWorkspace({ density, ...props }: LayoutProps & { density?: 'compact' }) {
  return <Layout {...props} recipe="action" density={density} />;
}

/** Summary first, followed by scannable account and position information. */
export function PortfolioWorkspace(props: LayoutProps) {
  return <Layout {...props} recipe="portfolio" />;
}

/** Predictable groups for account, preferences, and settings controls. */
export function AccountWorkspace(props: LayoutProps) {
  return <Layout {...props} recipe="account" />;
}
