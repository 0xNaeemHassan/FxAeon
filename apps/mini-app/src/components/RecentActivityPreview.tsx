'use client';

import type { Address } from 'viem';
import WalletActivity from './WalletActivity';

export default function RecentActivityPreview({ walletAddress, inDialog = false }: { walletAddress: Address; inDialog?: boolean }) {
  return <WalletActivity walletAddress={walletAddress} compact inDialog={inDialog} />;
}
