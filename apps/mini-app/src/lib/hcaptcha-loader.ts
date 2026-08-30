/**
 * Minimal hCaptcha script loader used by Privy's optional CAPTCHA screens.
 *
 * Privy's browser package depends on @hcaptcha/loader, whose distributed
 * bundle initializes a hCaptcha-owned Sentry client by default. FxAeon does
 * not ship or permit a telemetry client, so the webpack alias in
 * next.config.js routes that import through this API-compatible loader. The
 * CAPTCHA script and token flow remain unchanged; only the optional
 * diagnostic callbacks are intentionally omitted.
 */

type HCaptchaLoaderParams = {
  scriptLocation?: HTMLElement;
  secureApi?: boolean;
  scriptSource?: string;
  apihost?: string;
  loadAsync?: boolean;
  cleanup?: boolean;
  sentry?: boolean;
  custom?: boolean;
  assethost?: string;
  imghost?: string;
  reportapi?: string;
  endpoint?: string;
  host?: string;
  recaptchacompat?: string;
  hl?: string;
  uj?: boolean;
  maxRetries?: number;
  retryDelay?: number;
};

type BrowserWindow = Window & { hcaptcha?: unknown; hCaptchaOnLoad?: () => void };

const SCRIPT_ID = 'hCaptcha-script';
const ONLOAD_NAME = 'hCaptchaOnLoad';
const pendingByWindow = new WeakMap<BrowserWindow, Promise<unknown>>();

function queryString(params: HCaptchaLoaderParams): string {
  const values: Record<string, unknown> = {
    custom: params.custom,
    render: 'explicit',
    assethost: params.assethost,
    imghost: params.imghost,
    reportapi: params.reportapi,
    endpoint: params.endpoint,
    host: params.host,
    recaptchacompat: params.recaptchacompat,
    hl: params.hl,
    uj: params.uj,
  };
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

function scriptUrl(params: HCaptchaLoaderParams): string {
  const onload = `?onload=${ONLOAD_NAME}`;
  if (params.scriptSource) return `${params.scriptSource}${onload}`;
  const host = params.apihost ?? 'https://js.hcaptcha.com';
  return `${host}/1/${params.secureApi ? 'secure-api' : 'api'}.js${onload}`;
}

function loadOnce(params: HCaptchaLoaderParams, browserWindow: BrowserWindow, documentRef: Document): Promise<unknown> {
  const target = params.scriptLocation ?? documentRef.head;
  return new Promise((resolve, reject) => {
    const script = documentRef.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `${scriptUrl(params)}${queryString(params) ? `&${queryString(params)}` : ''}`;
    script.crossOrigin = 'anonymous';
    script.async = params.loadAsync ?? true;

    const cleanup = () => {
      if (!params.secureApi && params.cleanup && script.parentNode) script.parentNode.removeChild(script);
    };
    const finish = () => {
      cleanup();
      if (browserWindow.hcaptcha) resolve(browserWindow.hcaptcha);
      else reject(new Error('hCaptcha loaded without exposing an API'));
    };
    browserWindow.hCaptchaOnLoad = finish;
    script.onload = finish;
    script.onerror = () => {
      cleanup();
      reject(new Error('hCaptcha script failed to load'));
    };
    target.appendChild(script);
  });
}

export function hCaptchaLoader(params: HCaptchaLoaderParams = {}): Promise<unknown> {
  const documentRef = params.scriptLocation?.ownerDocument
    ?? (typeof document !== 'undefined' ? document : undefined);
  if (!documentRef) return Promise.reject(new Error('hCaptcha requires a browser document'));
  const browserWindow = (documentRef.defaultView ?? window) as BrowserWindow;
  if (browserWindow.hcaptcha) return Promise.resolve(browserWindow.hcaptcha);

  const pending = pendingByWindow.get(browserWindow);
  if (pending) return pending;

  const promise = loadOnce(params, browserWindow, documentRef);
  pendingByWindow.set(browserWindow, promise);
  void promise.finally(() => pendingByWindow.delete(browserWindow));
  return promise;
}
