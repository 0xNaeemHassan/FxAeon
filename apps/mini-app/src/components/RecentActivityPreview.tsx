'use client';

import type { Address } from 'viem';
import WalletActivity from './WalletActivity';

export default function RecentActivityPreview({ walletAddress }: { walletAddress: Address }) {
  return <WalletActivity walletAddress={walletAddress} compact />;
}
