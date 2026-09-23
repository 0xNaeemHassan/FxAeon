/** Keep a loaded selection usable only while its provider snapshot belongs to this wallet. */
export function borrowSelectionIsActionable(input: {
  walletAddress: string | undefined;
  snapshotWalletAddress: string | null | undefined;
  selectedKey: string;
  hasSelectedPosition: boolean;
  selectedStale: boolean;
}): boolean {
  const walletAddress = input.walletAddress?.toLowerCase();
  if (!walletAddress) return false;
  if (input.selectedKey === 'new') return true;
  if (input.snapshotWalletAddress?.toLowerCase() !== walletAddress) return false;
  return input.hasSelectedPosition && !input.selectedStale;
}
