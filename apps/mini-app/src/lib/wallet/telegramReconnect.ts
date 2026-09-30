'use client';

import { createContext, useContext } from 'react';

/** Restart Privy's documented seamless Mini App initialization on user intent. */
export const TelegramReconnectContext = createContext<() => void>(() => {
  throw new Error('Reopen FxAeon from Telegram to sign in again.');
});

export function useTelegramReconnect(): () => void {
  return useContext(TelegramReconnectContext);
}
