/**
 * Telegram Mini App platform integration (W-20).
 *
 * Single typed entry point for `window.Telegram.WebApp` — every page was
 * previously reaching for the raw global with `(window as any)`. All helpers
 * are no-ops outside Telegram so the app still works in a plain browser.
 */

export interface TgThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  destructive_text_color?: string;
}

interface TgButton {
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

interface TgMainButton extends TgButton {
  setText: (text: string) => void;
  enable: () => void;
  disable: () => void;
  showProgress: (leaveActive?: boolean) => void;
  hideProgress: () => void;
  isVisible: boolean;
}

export interface TgWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  themeParams: TgThemeParams;
  viewportStableHeight: number;
  isExpanded: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  sendData: (data: string) => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
  BackButton: TgButton;
  MainButton: TgMainButton;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
}

/** The WebApp object, or null outside Telegram / during SSR. */
export function getWebApp(): TgWebApp | null {
  if (typeof window === 'undefined') return null;
  return (window as any).Telegram?.WebApp ?? null;
}

/** True when running inside Telegram (initData present). */
export function isTMA(): boolean {
  return Boolean(getWebApp()?.initData);
}

/** Signal readiness + expand to full height. Safe to call repeatedly. */
export function initTelegram(): void {
  const tg = getWebApp();
  if (!tg) return;
  try {
    tg.ready();
    if (!tg.isExpanded) tg.expand();
  } catch {
    /* older clients */
  }
}

/** Haptic feedback — silently ignored outside Telegram / on old clients. */
export function haptic(
  kind: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'selection' = 'light'
): void {
  const h = getWebApp()?.HapticFeedback;
  if (!h) return;
  try {
    if (kind === 'selection') h.selectionChanged();
    else if (kind === 'success' || kind === 'error' || kind === 'warning')
      h.notificationOccurred(kind);
    else h.impactOccurred(kind);
  } catch {
    /* haptics are best-effort */
  }
}

/**
 * Map Telegram theme params onto CSS custom properties so styles can follow
 * the user's Telegram theme (`--tg-bg`, `--tg-text`, ...). Returns true when
 * params were applied.
 */
export function applyThemeParams(): boolean {
  const tg = getWebApp();
  if (!tg?.themeParams) return false;
  const root = document.documentElement;
  const map: Record<string, string | undefined> = {
    '--tg-bg': tg.themeParams.bg_color,
    '--tg-secondary-bg': tg.themeParams.secondary_bg_color,
    '--tg-text': tg.themeParams.text_color,
    '--tg-hint': tg.themeParams.hint_color,
    '--tg-link': tg.themeParams.link_color,
    '--tg-button': tg.themeParams.button_color,
    '--tg-button-text': tg.themeParams.button_text_color,
    '--tg-accent': tg.themeParams.accent_text_color,
    '--tg-destructive': tg.themeParams.destructive_text_color,
  };
  let applied = false;
  for (const [prop, value] of Object.entries(map)) {
    if (value) {
      root.style.setProperty(prop, value);
      applied = true;
    }
  }
  return applied;
}

/**
 * Keep `--tg-viewport-stable-height` in sync so fixed/full-height layouts
 * don't jump when the Telegram keyboard or header collapses the viewport.
 * Returns an unsubscribe function.
 */
export function bindViewportHeight(): () => void {
  const tg = getWebApp();
  const root = document.documentElement;
  const set = () => {
    const h = tg?.viewportStableHeight;
    root.style.setProperty(
      '--tg-viewport-stable-height',
      h ? `${h}px` : '100dvh'
    );
  };
  set();
  if (!tg) return () => {};
  tg.onEvent('viewportChanged', set);
  return () => tg.offEvent('viewportChanged', set);
}

/** Native BackButton: show + wire a handler. Returns cleanup. */
export function showBackButton(onBack: () => void): () => void {
  const tg = getWebApp();
  if (!tg?.BackButton) return () => {};
  const handler = () => {
    haptic('light');
    onBack();
  };
  try {
    tg.BackButton.onClick(handler);
    tg.BackButton.show();
  } catch {
    return () => {};
  }
  return () => {
    try {
      tg.BackButton.offClick(handler);
      tg.BackButton.hide();
    } catch {
      /* noop */
    }
  };
}

/** Native MainButton: configure + wire a handler. Returns cleanup. */
export function showMainButton(text: string, onClick: () => void): () => void {
  const tg = getWebApp();
  if (!tg?.MainButton) return () => {};
  const handler = () => {
    haptic('medium');
    onClick();
  };
  try {
    tg.MainButton.setText(text);
    tg.MainButton.onClick(handler);
    tg.MainButton.enable();
    tg.MainButton.show();
  } catch {
    return () => {};
  }
  return () => {
    try {
      tg.MainButton.offClick(handler);
      tg.MainButton.hide();
    } catch {
      /* noop */
    }
  };
}
