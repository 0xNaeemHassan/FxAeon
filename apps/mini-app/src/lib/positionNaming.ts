/**
 * One name for a position wherever it appears: its row, Trade's ticket, the
 * result of the transaction that opened it, and that transaction in History.
 */
export type PositionNameMarket = 'ETH' | 'BTC';
export type PositionNameSide = 'long' | 'short';

/** The side as a word: "Long" or "Short". */
export function positionSideLabel(side: PositionNameSide): string {
  return side === 'long' ? 'Long' : 'Short';
}

/** "ETH Long", "BTC Short". */
export function positionName(market: PositionNameMarket, side: PositionNameSide): string {
  return `${market} ${positionSideLabel(side)}`;
}

/** What opening a position did, said the same way in its result and in History: "Opened ETH Long". */
export function openedPositionTitle(market: PositionNameMarket, side: PositionNameSide): string {
  return `Opened ${positionName(market, side)}`;
}
