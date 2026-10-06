/**
 * Privy build-time configuration — kept in a tiny standalone module so pages
 * can check it WITHOUT pulling the heavy @privy-io/react-auth bundle into
 * their chunk; wallet routes load it only when needed.
 */

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

/** True when this build can talk to Privy. */
export function privyConfigured(): boolean {
  return Boolean(APP_ID);
}

export const PRIVY_APP_ID = APP_ID;
