import { parseConfirmedPositionHint, type ConfirmedPositionHint } from './confirmedPositions';

export interface StoredPositionHint { hint: ConfirmedPositionHint; addedAt: number }
export const confirmedPositionHintKey = (hint: ConfirmedPositionHint) => `${hint.market}:${hint.side}:${hint.positionId}`;
export const confirmedPositionStorageKey = (wallet: string) => `fxaeon:confirmed-positions:v1:${wallet.toLowerCase()}`;
const MAX_HINTS = 12;
const MAX_AGE = 24 * 60 * 60 * 1000;

// These records only help rediscover a receipt. No financial values are stored,
// and callers must verify the receipt and current NFT owner before displaying it.
export function parseStoredPositionHints(raw: string | null, wallet: string, now = Date.now()): StoredPositionHint[] {
  try {
    if (!raw || raw.length > 32_000) return [];
    const items: unknown = JSON.parse(raw);
    if (!Array.isArray(items) || items.length > MAX_HINTS) return [];
    const seen = new Set<string>();
    return items.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object' || !('hint' in item) || !('addedAt' in item)) return [];
      const hint = parseConfirmedPositionHint(item.hint, wallet);
      const addedAt = item.addedAt;
      if (!hint || typeof addedAt !== 'number' || !Number.isSafeInteger(addedAt) || addedAt > now || now - addedAt > MAX_AGE) return [];
      const key = confirmedPositionHintKey(hint);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ hint, addedAt }];
    });
  } catch { return []; }
}

export function savePositionHints(storage: Pick<Storage, 'setItem' | 'removeItem'>, wallet: string, records: StoredPositionHint[]): void {
  try {
    const key = confirmedPositionStorageKey(wallet);
    if (records.length) storage.setItem(key, JSON.stringify(records.slice(-MAX_HINTS)));
    else storage.removeItem(key);
  } catch { /* Storage restrictions must not change transaction success. */ }
}
