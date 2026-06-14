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
  /** 'android' | 'ios' | 'tdesktop' | ... — 'unknown' outside Telegram. */
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: TgThemeParams;
  viewportStableHeight: number;
  isExpanded: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  sendData: (data: string) => void;
  openTelegramLink?: (url: string) => void;
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

/**
 * True when running inside Telegram.
 *
 * IMPORTANT (this was the root cause of the broken onboarding loop):
 * keyboard-button Mini App launches — the ONLY launches where sendData()
 * works — receive an EMPTY initData. Detecting Telegram via initData
 * therefore fails exactly when it matters most. The platform field is
 * 'unknown' outside Telegram and a real value inside, for every launch type.
 */
export function isTMA(): boolean {
  const tg = getWebApp();
  if (!tg) return false;
  return Boolean(tg.initData) || (Boolean(tg.platform) && tg.platform !== 'unknown');
}

/**
 * True when this launch can use WebApp.sendData() (keyboard-button launches:
 * inside Telegram with empty initData). Inline/menu/direct launches must use
 * the authenticated bot API instead.
 */
export function canSendData(): boolean {
  const tg = getWebApp();
  return Boolean(tg) && isTMA() && !tg!.initData;
}

/** Signed initData for API auth — empty string for keyboard launches. */
export function getInitData(): string {
  return getWebApp()?.initData ?? '';
}

/**
 * Telegram's UI language for the launching user (e.g. 'en', 'ru', 'zh-hans').
 * Read from initDataUnsafe — present on launches that carry a user, '' otherwise.
 * Used only as a first-paint locale hint; the saved User.language wins once loaded.
 */
export function getTelegramLanguage(): string {
  const tg = getWebApp() as unknown as {
    initDataUnsafe?: { user?: { language_code?: string } };
  } | null;
  return tg?.initDataUnsafe?.user?.language_code ?? '';
}

/**
 * Restore the Telegram launch hash (`#tgWebAppData=…`) onto the current URL.
 *
 * WHY (P0 login fix): Privy's seamless Mini-App login is AUTOMATIC — at
 * provider mount the SDK looks for `#tgWebAppData=…` in `location.hash`,
 * verifies the signed launch params server-side and logs the user in with no
 * popup. Telegram puts that hash on the INITIAL document URL only; our entry
 * router (`app/page.tsx`) client-navigates to /login, which drops it, so by
 * the time the Privy provider mounts the hash is gone and the SDK silently
 * skips seamless auth. Every other path then falls back to the Telegram
 * login WIDGET (`window.Telegram.Login.auth`) — a popup that cannot post its
 * result back inside Telegram's own webview. That is the exact
 * "Telegram auth failed or was canceled by the client" dead end (the
 * official "logged in successfully" notification fires because the popup
 * half DOES complete server-side).
 *
 * `WebApp.initData` is the same signed payload, available on every page, so
 * we rebuild the hash from it right before the provider mounts. The SDK
 * consumes and cleans the hash; this is idempotent and a no-op outside
 * Telegram or on keyboard launches (empty initData).
 */
export function restoreTelegramLaunchHash(): void {
  if (typeof window === 'undefined') return;
  const initData = getWebApp()?.initData;
  if (!initData) return;
  if (window.location.hash.startsWith('#tgWebAppData')) return;
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}#tgWebAppData=${encodeURIComponent(initData)}`
    );
  } catch {
    /* best-effort — worst case the flow falls back to explicit sign-in */
  }
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
