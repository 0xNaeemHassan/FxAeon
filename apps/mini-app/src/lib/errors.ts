/**
 * Keep useful protocol validation messages while preventing RPC URLs, public
 * API keys, request bodies, or multiline provider diagnostics from being
 * painted into the Telegram UI.
 */
export function userSafeError(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const message = raw.replace(/\s+/g, ' ').trim();
  if ((cause instanceof Error && /^(AbortError|TimeoutError)$/.test(cause.name))
    || /^(?:signal is aborted without reason|the operation was aborted\.?|the user aborted a request\.?)$/i.test(message)) {
    return 'The request timed out or was interrupted. Try again.';
  }
  if (
    !message
    || message.length > 280
    || /(?:https?|wss?):\/\//i.test(message)
    || /(?:request body|authorization|api[-_ ]?key|stack trace)/i.test(message)
  ) {
    return fallback;
  }
  if (/^Your [xs]POSITION leverage is higher than the maximum leverage allowed, please lower your leverage level\.$/.test(message)) {
    return 'Lower the target leverage for this amount.';
  }
  if (/^Your [xs]POSITION leverage is lower than the minimum leverage required, please increase your leverage level\.$/.test(message)) {
    return 'Increase the target leverage for this amount.';
  }
  return message;
}
