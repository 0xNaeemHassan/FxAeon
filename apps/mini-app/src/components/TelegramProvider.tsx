'use client';

/**
 * Telegram Mini App platform glue.
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

/** Screens that act as app roots — BackButton hidden (Telegram shows ✕). */
const ROOT_PATHS = new Set(['/', '/login', '/portfolio']);
const LEGACY_CACHE_NAME = 'fxaeon-static-v1';
const LEGACY_WORKER_RELOAD_KEY = 'fxaeon:legacy-worker-reload';

async function releaseLegacyServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const isLegacyFxAeonWorker = (worker: ServiceWorker | null | undefined): boolean => {
    if (!worker?.scriptURL) return false;
    try {
      const url = new URL(worker.scriptURL);
      return url.origin === window.location.origin && url.pathname === '/sw.js';
    } catch {
      return false;
    }
  };
  const wasControlled = isLegacyFxAeonWorker(navigator.serviceWorker.controller);
  const registrations = await navigator.serviceWorker.getRegistrations();
  const legacyRegistrations = registrations.filter((registration) =>
    isLegacyFxAeonWorker(registration.active)
    || isLegacyFxAeonWorker(registration.waiting)
    || isLegacyFxAeonWorker(registration.installing),
  );
  await Promise.allSettled(legacyRegistrations.map((registration) => registration.unregister()));

  // Delete only the cache name owned by the retired FxAeon worker. Other
  // origin caches may belong to Privy or the hosting platform.
  if (legacyRegistrations.length > 0 && 'caches' in window) {
    await window.caches.delete(LEGACY_CACHE_NAME);
  }

  // unregister() does not release the controller from the current document.
  // Reload once so an upgraded Telegram tab cannot continue receiving stale
  // financial navigation from the retired worker until it is closed.
  if (wasControlled && sessionStorage.getItem(LEGACY_WORKER_RELOAD_KEY) !== '1') {
    sessionStorage.setItem(LEGACY_WORKER_RELOAD_KEY, '1');
    window.location.reload();
  } else if (!wasControlled) {
    sessionStorage.removeItem(LEGACY_WORKER_RELOAD_KEY);
  }
}

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
    const tg = getWebApp();
    const syncTheme = () => {
      applyThemeParams();
      applyTheme(getSavedTheme());
    };
    const unbindViewport = bindViewportHeight();
    tg?.onEvent('themeChanged', syncTheme);

    // Financial state must never be served from the legacy offline cache.
    // Remove any worker installed by an older FxAeon build; the static app
    // remains online-only and always rereads authoritative chain state.
    void releaseLegacyServiceWorker();

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
