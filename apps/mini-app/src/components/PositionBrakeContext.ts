'use client';

import { createContext, useContext, useEffect } from 'react';
import type { UiPosition } from '@/app/trade/fxUi';
import type { BrakeReading } from '@/lib/positionBrake';

/** A read older than this is no longer shown as current. Reads normally
 * follow every position refresh (each Ethereum block while it is live). */
export const POSITION_BRAKE_MAX_AGE_MS = 120_000;

export interface PositionBrakeRecord {
  reading: BrakeReading;
  readAt: number;
  /** The position amounts this read belongs to; changed amounts need a new read. */
  rawColls: bigint;
  rawDebts: bigint;
}

export interface PositionBrakeEntry {
  /** The latest successful read, kept through a failed refresh until it ages out. */
  record: PositionBrakeRecord | null;
  /** A read covering this position is in flight. */
  pending: boolean;
  /** The latest read for this position failed. */
  failed: boolean;
}

export interface PositionBrakeStore {
  entries: ReadonlyMap<string, PositionBrakeEntry>;
  /** Cards register while mounted, so reads run only while one is shown. */
  register: () => () => void;
}

export const PositionBrakeContext = createContext<PositionBrakeStore | null>(null);

export type PositionBrakeStatus =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; reading: BrakeReading; readAt: number };

type BrakePosition = Pick<UiPosition, 'market' | 'side'> & { info: Pick<UiPosition['info'], 'positionId' | 'rawColls' | 'rawDebts'> };

export function positionBrakeKey(position: BrakePosition): string {
  return `${position.market}:${position.side}:${position.info.positionId}`;
}

/**
 * What a card may show for its position: a current read for these exact
 * amounts, a placeholder while one is coming, or nothing once reads failed or
 * aged out. A position without debt has no brake.
 */
export function resolvePositionBrake(store: PositionBrakeStore | null, position: BrakePosition, now: number): PositionBrakeStatus {
  if (position.info.rawDebts <= 0n) return { status: 'none' };
  if (!store) return { status: 'unavailable' };
  const entry = store.entries.get(positionBrakeKey(position));
  const record = entry?.record ?? null;
  const sameAmounts = record !== null && record.rawColls === position.info.rawColls && record.rawDebts === position.info.rawDebts;
  if (record && sameAmounts && now >= record.readAt && now - record.readAt <= POSITION_BRAKE_MAX_AGE_MS) {
    return { status: 'ready', reading: record.reading, readAt: record.readAt };
  }
  // A registered card starts the first read, and changed amounts start the next.
  if (!entry || entry.pending || (record && !sameAmounts && !entry.failed)) return { status: 'loading' };
  return { status: 'unavailable' };
}

export function usePositionBrake(position: BrakePosition): PositionBrakeStatus {
  const store = useContext(PositionBrakeContext);
  const register = store?.register;
  useEffect(() => register?.(), [register]);
  return resolvePositionBrake(store, position, Date.now());
}
