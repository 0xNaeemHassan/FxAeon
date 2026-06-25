/**
 * A deterministic `window.Telegram.WebApp` shim, injected via addInitScript so
 * it exists BEFORE any page code runs (the real app loads telegram-web-app.js
 * with `strategy="beforeInteractive"`; the suite blocks that network script and
 * substitutes this).
 *
 * It implements exactly the surface lib/telegram.ts touches: initData / platform
 * (so isTMA() is true), ready/expand/close/sendData/openTelegramLink, the
 * viewport event, BackButton/MainButton and HapticFeedback. Calls that a test
 * may want to assert (close, openTelegramLink, sendData, MainButton text) are
 * recorded on `window.__tg`.
 */
export interface TelegramShimOptions {
  /** Signed launch payload. Non-empty → inline/menu launch (API auth works). */
  initData?: string;
  /** '' → keyboard-button launch (sendData path); non-empty → API path. */
  platform?: string;
  languageCode?: string;
}

/** Serializable init script — runs in the browser before page scripts. */
export function telegramInitScript(_opts: TelegramShimOptions = {}): (o: TelegramShimOptions) => void {
  return (o: TelegramShimOptions) => {
    const initData =
      o.initData ??
      'query_id=AAH_test&user=%7B%22id%22%3A777%2C%22first_name%22%3A%22Aeon%22%2C%22language_code%22%3A%22en%22%7D&auth_date=1700000000&hash=deadbeefcafe';
    const platform = o.platform ?? 'tdesktop';
    const language = o.languageCode ?? 'en';

    const record: Record<string, unknown[]> = {};
    const log = (name: string, ...args: unknown[]) => {
      (record[name] ??= []).push(args.length <= 1 ? args[0] : args);
    };

    const makeButton = (name: string) => {
      const handlers = new Set<() => void>();
      return {
        isVisible: false,
        _handlers: handlers,
        show() { (this as { isVisible: boolean }).isVisible = true; log(`${name}.show`); },
        hide() { (this as { isVisible: boolean }).isVisible = false; log(`${name}.hide`); },
        onClick(cb: () => void) { handlers.add(cb); },
        offClick(cb: () => void) { handlers.delete(cb); },
        setText(t: string) { log(`${name}.setText`, t); },
        enable() { log(`${name}.enable`); },
        disable() { log(`${name}.disable`); },
        showProgress() { log(`${name}.showProgress`); },
        hideProgress() { log(`${name}.hideProgress`); },
        /** test helper: fire the wired handlers */
        _click() { handlers.forEach((h) => h()); },
      };
    };

    const events: Record<string, Set<() => void>> = {};
    const webApp = {
      initData,
      initDataUnsafe: { user: { id: 777, first_name: 'Aeon', language_code: language } },
      platform,
      colorScheme: 'dark',
      themeParams: { bg_color: '#0a0a12', text_color: '#ffffff' },
      viewportStableHeight: 844,
      isExpanded: false,
      ready() { log('ready'); },
      expand() { (this as { isExpanded: boolean }).isExpanded = true; log('expand'); },
      close() { log('close'); },
      sendData(data: string) { log('sendData', data); },
      openTelegramLink(url: string) { log('openTelegramLink', url); },
      onEvent(name: string, cb: () => void) { (events[name] ??= new Set()).add(cb); },
      offEvent(name: string, cb: () => void) { events[name]?.delete(cb); },
      BackButton: makeButton('BackButton'),
      MainButton: makeButton('MainButton'),
      HapticFeedback: {
        impactOccurred() { log('haptic.impact'); },
        notificationOccurred() { log('haptic.notification'); },
        selectionChanged() { log('haptic.selection'); },
      },
    };

    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: webApp };
    (window as unknown as { __tg: unknown }).__tg = { record, webApp, events };
  };
}
