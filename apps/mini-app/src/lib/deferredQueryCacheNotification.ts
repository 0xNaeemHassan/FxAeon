import { notifyManager } from '@tanstack/react-query';

/** Defer TanStack cache callbacks so they cannot update React during render. */
export function createDeferredQueryCacheNotification(onChange: () => void): {
  notify: () => void;
  dispose: () => void;
} {
  let active = true;
  return {
    notify: notifyManager.batchCalls(() => { if (active) onChange(); }),
    dispose: () => { active = false; },
  };
}
