/**
 * Privy build-time configuration — kept in a tiny standalone module so pages
 * can check it WITHOUT pulling the heavy @privy-io/react-auth bundle into
 * their chunk (W-20 perf budget: the SDK only loads on surfaces that use it).
 */

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

/** True when this build can talk to Privy. */
export function privyConfigured(): boolean {
  return Boolean(APP_ID);
}

export const PRIVY_APP_ID = APP_ID;

/**
 * The Privy key-quorum id used for session-signer grants ("bot trading").
 * Without it, wallets still work — only chat-based execution stays off until
 * the user grants access.
 */
export const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID || '';
