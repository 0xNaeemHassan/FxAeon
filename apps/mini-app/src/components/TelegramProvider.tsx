'use client';

/**
 * Telegram Mini App platform glue (W-20).
 *
 * - calls WebApp.ready() + expand() on mount
 * - maps themeParams → CSS custom properties (and re-applies on themeChanged)
 * - keeps --tg-viewport-stable-height in sync (viewportChanged)
 * - shows the NATIVE BackButton on sub-pages and wires it to router.back()
 *   (root pages "/", "/login", "/portfolio" keep it hidden)
 *
 * Everything is a no-op outside Telegram, so the app still works in a browser.
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  applyThemeParams,
  bindViewportHeight,
  getWebApp,
  initTelegram,
  isTMA,
  showBackButton,
} from '@/lib/telegram';

const ROOT_PATHS = new Set(['/', '/login', '/portfolio']);

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // One-time platform init + theme/viewport bindings.
  useEffect(() => {
    initTelegram();
    applyThemeParams();
    const unbindViewport = bindViewportHeight();

    const tg = getWebApp();
    const onThemeChanged = () => applyThemeParams();
    tg?.onEvent('themeChanged', onThemeChanged);

    return () => {
      unbindViewport();
      tg?.offEvent('themeChanged', onThemeChanged);
    };
  }, []);

  // Native BackButton on sub-pages.
  useEffect(() => {
    if (!isTMA() || ROOT_PATHS.has(pathname ?? '/')) return;
    return showBackButton(() => router.back());
  }, [pathname, router]);

  return <>{children}</>;
}
