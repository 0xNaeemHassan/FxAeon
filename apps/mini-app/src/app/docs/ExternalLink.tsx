'use client';

import type { MouseEvent, ReactNode } from 'react';
import { openExternalLink } from '@/lib/telegram';

/**
 * A link that leaves FxAeon: a new tab on the web, and Telegram's own browser
 * inside the Mini App, so another site never replaces the app's webview.
 */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openExternalLink(href)) event.preventDefault();
  };
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={open}>{children}</a>;
}
