import type { PositionInfo } from '@aladdindao/fx-sdk';
import { createFxSdkFacade } from './sdk';
import type { FxSdkFacade } from './types';

/** Maximum time a browser read is allowed to occupy a route refresh. */
export const FX_READ_DEADLINE_MS = 12_000;

type ReadMethods = Pick<FxSdkFacade, 'getPositions' | 'getBridgeQuote' | 'getFxSaveBalance' | 'getFxSaveConfig' | 'getFxSaveRedeemStatus' | 'getFxSaveClaimable'>;
export type FxSaveConfig = Awaited<ReturnType<FxSdkFacade['getFxSaveConfig']>>;
export type FxSaveBalance = Awaited<ReturnType<FxSdkFacade['getFxSaveBalance']>>;
export type FxSaveRedeemStatus = Awaited<ReturnType<FxSdkFacade['getFxSaveRedeemStatus']>>;
export type FxSaveClaimable = Awaited<ReturnType<FxSdkFacade['getFxSaveClaimable']>>;

/**
 * Promise.race bounds the UI even when an SDK transport does not expose an
 * AbortSignal. The late promise is still observed so a timeout cannot create
 * an unhandled rejection; callers must use a generation guard before applying
 * the result to state.
 */
export function withReadDeadline<T>(task: Promise<T>, timeoutMs = FX_READ_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bounded = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`read deadline exceeded after ${timeoutMs}ms`)), timeoutMs);
    task.then(resolve, reject);
  });
  return bounded.finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

function strictPositions(value: unknown): PositionInfo[] {
  if (!Array.isArray(value)) throw new TypeError('fx-sdk position response must be an array');
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new TypeError('fx-sdk returned a malformed position');
    const position = item as Partial<PositionInfo>;
    if (!Number.isSafeInteger(position.positionId) || (position.positionId as number) < 0) {
      throw new TypeError('indexer returned a malformed position ID');
    }
    if (typeof position.rawColls !== 'bigint' || typeof position.rawDebts !== 'bigint' || position.rawColls < 0n || position.rawDebts < 0n || position.rawColls > MAX_UINT256 || position.rawDebts > MAX_UINT256) {
      throw new TypeError('indexer returned malformed position accounting fields');
    }
    const collsDecimals = position.rawCollsDecimals;
    const debtsDecimals = position.rawDebtsDecimals;
    if (typeof position.rawCollsToken !== 'string' || !position.rawCollsToken || typeof position.rawDebtsToken !== 'string' || !position.rawDebtsToken
      || typeof collsDecimals !== 'number' || !Number.isSafeInteger(collsDecimals) || collsDecimals < 0 || collsDecimals > 255
      || typeof debtsDecimals !== 'number' || !Number.isSafeInteger(debtsDecimals) || debtsDecimals < 0 || debtsDecimals > 255
      || typeof position.currentLeverage !== 'number' || !Number.isFinite(position.currentLeverage) || position.currentLeverage < 0
      || typeof position.lsdLeverage !== 'number' || !Number.isFinite(position.lsdLeverage) || position.lsdLeverage < 0) {
      throw new TypeError(`indexer returned malformed fields for position ${String(position.positionId)}`);
    }
  }
  return value as PositionInfo[];
}

const MAX_UINT256 = (1n << 256n) - 1n;

export interface FxReadFacade extends ReadMethods {
  getPositions: (...args: Parameters<ReadMethods['getPositions']>) => Promise<PositionInfo[]>;
}

let readFacade: FxReadFacade | undefined;

/** Application-owned, read-only boundary around the approved SDK methods. */
export function getFxReadFacade(): FxReadFacade {
  if (readFacade) return readFacade;
  const sdk = createFxSdkFacade();
  readFacade = {
    getPositions: async (...args) => strictPositions(await withReadDeadline(sdk.getPositions(...args))),
    getBridgeQuote: (...args) => withReadDeadline(sdk.getBridgeQuote(...args)),
    getFxSaveBalance: (...args) => withReadDeadline(sdk.getFxSaveBalance(...args)),
    getFxSaveConfig: (...args) => withReadDeadline(sdk.getFxSaveConfig(...args)),
    getFxSaveRedeemStatus: (...args) => withReadDeadline(sdk.getFxSaveRedeemStatus(...args)),
    getFxSaveClaimable: (...args) => withReadDeadline(sdk.getFxSaveClaimable(...args)),
  };
  return readFacade;
}

export function resetFxReadFacadeForTests(): void {
  readFacade = undefined;
}
