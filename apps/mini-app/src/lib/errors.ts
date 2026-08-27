/**
 * Keep useful protocol validation messages while preventing RPC URLs, public
 * API keys, request bodies, or multiline provider diagnostics from being
 * painted into the Telegram UI.
 */
export function userSafeError(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const message = raw.replace(/\s+/g, ' ').trim();
  if (
    !message
    || message.length > 280
    || /(?:https?|wss?):\/\//i.test(message)
    || /(?:request body|authorization|api[-_ ]?key|stack trace)/i.test(message)
  ) {
    return fallback;
  }
  return message;
}
