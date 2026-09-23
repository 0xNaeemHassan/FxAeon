import { formatUnits, type Address } from 'viem';
import { FX_TOKENS } from './fx/tokens';
import type { FxChainId } from './fx/types';
import type { ConfirmedPositionHint } from './confirmedPositions';

export type ReceiptTransferFact = { token: Address; from: Address; to: Address; amountRaw: bigint };
export type ReceiptPresentation = {
  movements: string[];
  technicalMovements: string[];
  executionFee: string | null;
  feeLabel: 'Network fee' | 'Execution fee';
  feeCaveat: string | null;
  nativeValue: string | null;
};

export type ReceiptPositionIdentity = Pick<ConfirmedPositionHint, 'market' | 'side' | 'positionId' | 'transactionHash'>;
/** Hints are supplied by ProtocolPositionProvider only after receipt and current-owner verification. */
export function verifiedReceiptPositionIdentity(input: {
  status: 'pending' | 'confirmed' | 'failed';
  verification: 'receipt' | 'confirming' | 'not-found' | 'rpc-error' | 'mismatch';
  transactionHash: string;
  hint?: ReceiptPositionIdentity;
}): ReceiptPositionIdentity | null {
  if (input.status !== 'confirmed' || input.verification !== 'receipt' || !input.hint
    || input.hint.transactionHash.toLowerCase() !== input.transactionHash.toLowerCase()) return null;
  return input.hint;
}

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Decode only canonical three-topic ERC-20 Transfer logs involving this wallet. */
export function receiptTransfersFromLogs(
  logs: readonly { address: string; topics: readonly (string | null)[]; data: string }[],
  walletAddress: string,
): ReceiptTransferFact[] {
  return logs.flatMap((log) => {
    const fromTopic = log.topics[1];
    const toTopic = log.topics[2];
    if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC
      || !fromTopic || !toTopic || !/^0x[0-9a-fA-F]{64}$/.test(fromTopic)
      || !/^0x[0-9a-fA-F]{64}$/.test(toTopic) || !/^0x0{24}[0-9a-fA-F]{40}$/.test(fromTopic)
      || !/^0x0{24}[0-9a-fA-F]{40}$/.test(toTopic) || !/^0x[0-9a-fA-F]{64}$/.test(log.data)
      || !/^0x[0-9a-fA-F]{40}$/.test(log.address)) return [];
    const from = `0x${fromTopic.slice(-40)}`;
    const to = `0x${toTopic.slice(-40)}`;
    if (from.toLowerCase() !== walletAddress.toLowerCase() && to.toLowerCase() !== walletAddress.toLowerCase()) return [];
    if (from.toLowerCase() === to.toLowerCase()) return [];
    return [{ token: log.address as Address, from: from as Address, to: to as Address, amountRaw: BigInt(log.data) }];
  });
}

function compactAmount(raw: bigint, decimals: number): string {
  const exact = formatUnits(raw, decimals);
  const [whole, fraction = ''] = exact.split('.');
  const shown = fraction.slice(0, 6).replace(/0+$/, '');
  const truncated = /[1-9]/.test(fraction.slice(6));
  if (truncated && whole === '0' && shown.length === 0) return '<0.000001';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${truncated ? '≈ ' : ''}${grouped}${shown ? `.${shown}` : ''}`;
}

/** Convert receipt-only facts into concise copy, keeping unknown token data technical. */
export function buildReceiptPresentation(input: {
  chainId: FxChainId;
  walletAddress?: string;
  status: 'success' | 'reverted';
  transfers?: readonly ReceiptTransferFact[];
  executionCostWei?: bigint;
  nativeValueWei?: bigint;
}): ReceiptPresentation {
  const walletTokens = Object.values(FX_TOKENS).filter((token) => !token.native);
  const movements: string[] = [];
  const technicalMovements: string[] = [];
  if (input.status === 'success') for (const transfer of input.transfers ?? []) {
    const known = input.chainId === 1
      ? walletTokens.find((token) => token.address.toLowerCase() === transfer.token.toLowerCase())
      : undefined;
    const direction = known ? (transfer.from.toLowerCase() === input.walletAddress?.toLowerCase() ? 'sent' : 'received') : '';
    if (known) {
      movements.push(`${direction} ${compactAmount(transfer.amountRaw, known.decimals)} ${known.key}`);
    } else {
      movements.push('Token movement available in technical details');
      technicalMovements.push(`${transfer.from} → ${transfer.to}: token ${transfer.token}, ${transfer.amountRaw.toString()} base units`);
    }
  }
  return {
    movements,
    technicalMovements,
    executionFee: input.executionCostWei === undefined ? null : `${compactAmount(input.executionCostWei, 18)} ETH`,
    feeLabel: input.chainId === 8453 ? 'Execution fee' : 'Network fee',
    feeCaveat: input.chainId === 8453 && input.executionCostWei !== undefined ? 'Base L1 and operator fees are not included.' : null,
    nativeValue: input.status === 'success' && input.nativeValueWei && input.nativeValueWei > 0n
      ? `${compactAmount(input.nativeValueWei, 18)} ETH` : null,
  };
}
