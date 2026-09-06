export function isForegroundOnline(): boolean {
  return typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && (typeof navigator === 'undefined' || navigator.onLine !== false);
}

/** Subscribe once to the browser signals that make a foreground read safe. */
export function subscribeToForegroundResume(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const resume = () => { if (isForegroundOnline()) callback(); };
  window.addEventListener('focus', resume);
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  return () => {
    window.removeEventListener('focus', resume);
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}
