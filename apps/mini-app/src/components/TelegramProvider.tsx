'use client';

/**
 * Telegram Mini App platform glue (W-20, rebuilt in the E2E overhaul).
 *
 * - calls WebApp.ready() + expand() on mount
 * - keeps --tg-viewport-stable-height in sync (viewportChanged)
 * - tracks an in-app navigation stack so the NATIVE BackButton does the
 *   right thing on every launch type:
 *     · in-app history → router.back()
 *     · launched directly onto a sub-page (inline/menu button) → close()
 *   The old version keyed off initData, which is EMPTY for keyboard
 *   launches, so the back button silently did nothing.
 *
 * Everything is a no-op outside Telegram, so the app still works in a browser.
 */
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  applyThemeParams,
  bindViewportHeight,
  getWebApp,
  initTelegram,
  isTMA,
  showBackButton,
} from '@/lib/telegram';
import { applyTheme, getSavedTheme } from '@/lib/theme';
import { biometrics } from '@/lib/biometrics';

/** Screens that act as app roots — BackButton hidden (Telegram shows ✕). */
const ROOT_PATHS = new Set(['/', '/login', '/portfolio']);

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Visited-path stack for back-vs-close decisions.
  const stack = useRef<string[]>([]);

  // One-time platform init + viewport binding + theme application.
  useEffect(() => {
    initTelegram();
    applyThemeParams();
    applyTheme(getSavedTheme());
    void biometrics.init();
    const tg = getWebApp();
    const syncTheme = () => {
      applyThemeParams();
      applyTheme(getSavedTheme());
    };
    const unbindViewport = bindViewportHeight();
    tg?.onEvent('themeChanged', syncTheme);
    return () => {
      unbindViewport();
      tg?.offEvent('themeChanged', syncTheme);
    };
  }, []);

  // Maintain the nav stack.
  useEffect(() => {
    const path = pathname ?? '/';
    const s = stack.current;
    if (s.length >= 2 && s[s.length - 2] === path) {
      s.pop(); // back navigation
    } else if (s[s.length - 1] !== path) {
      s.push(path); // forward navigation
    }
  }, [pathname]);

  // Native BackButton on sub-pages: back through in-app history, close when
  // the sub-page was the entry point.
  useEffect(() => {
    if (!isTMA() || ROOT_PATHS.has(pathname ?? '/')) return;
    return showBackButton(() => {
      if (stack.current.length > 1) router.back();
      else getWebApp()?.close();
    });
  }, [pathname, router]);

  return <>{children}</>;
}
