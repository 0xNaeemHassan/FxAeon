'use client';

/**
 * The single Privy boundary for the web and Telegram app.
 *
 * Privy is deliberately configured as a client-side wallet and signing
 * provider. FxAeon never receives a private key, authorization key, session
 * signer grant, or transaction authority. Protocol components ask the
 * user's selected wallet to sign each planned transaction explicitly.
 *
 * Keep this provider mounted once, above all authenticated routes. Nested
 * providers create independent sessions and can make a wallet appear to
 * change between screens.
 */
import { useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { base, mainnet } from 'viem/chains';
import { PRIVY_APP_ID } from '@/lib/privyConfig';
import { restoreTelegramLaunchHash } from '@/lib/telegram';
import { PrivyWalletBridge, UnavailableWalletProvider } from '@/lib/wallet';
import WalletRecoveryCoordinator from '@/components/WalletRecoveryCoordinator';
import ProtocolPositionProvider from '@/components/ProtocolPositionProvider';
import WalletDataProvider from '@/components/WalletDataProvider';

export default function PrivyClientProvider({ children }: { children: React.ReactNode }) {
  // P0 login fix: Privy's seamless Telegram Mini-App login triggers at SDK
  // mount IF `#tgWebAppData=…` is still on the URL. Our entry router drops
  // it, so restore it from WebApp.initData BEFORE the provider mounts. A
  // useState initializer runs synchronously during the first render — ahead
  // of every child/provider effect — which is exactly the ordering needed.
  // (See restoreTelegramLaunchHash for the full story.)
  useState(() => {
    // A no-Privy build is deliberately used by static/E2E checks. It must
    // remain a plain public site: restoring Telegram's launch hash would
    // mutate the URL even though no Privy provider exists to consume it.
    if (PRIVY_APP_ID) restoreTelegramLaunchHash();
    return true;
  });
  if (!PRIVY_APP_ID) return (
    <UnavailableWalletProvider>
      <WalletDataProvider>
        <ProtocolPositionProvider>
          <WalletRecoveryCoordinator />
          {children}
        </ProtocolPositionProvider>
      </WalletDataProvider>
    </UnavailableWalletProvider>
  );
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#7c5cff',
          // FxAeon is EVM-only. Do not expose Solana wallet choices.
          walletChainType: 'ethereum-only',
          showWalletLoginFirst: true,
        },
        // The protocol uses Ethereum for f(x) and fxSAVE and Base as the
        // supported bridge destination/source. Ethereum remains the default.
        supportedChains: [mainnet, base],
        defaultChain: mainnet,
        embeddedWallets: {
          // Wallet creation is an explicit user action in the wallet flow.
          ethereum: { createOnLogin: 'off' },
          // Always display Privy's signing UI. Transaction components may
          // repeat this per request; the provider-level setting is fail-safe.
          showWalletUIs: true,
        },
      }}
    >
      <PrivyWalletBridge>
        <WalletDataProvider>
          <ProtocolPositionProvider>
            <WalletRecoveryCoordinator />
            {children}
          </ProtocolPositionProvider>
        </WalletDataProvider>
      </PrivyWalletBridge>
    </PrivyProvider>
  );
}
