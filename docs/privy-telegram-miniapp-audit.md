# Privy configuration audit for the Telegram Mini App

Audit date: 2026-10-03. SDK evidence is from the installed `@privy-io/react-auth` **3.45.0** package. Dashboard observations are from the live dashboard audit for this app.

## Current dashboard and app configuration

| Setting | Observed state | Effect on this optimization |
| --- | --- | --- |
| TEE wallet execution | Enabled | Keep the current managed signing path. This is not the source of the app's configurable HTTP fallback behavior. |
| Smart wallets | Off | No ERC-4337 smart-wallet account migration is in scope. |
| Native gas sponsorship | Off | Keep disabled during this fix; enabling it changes transaction fee handling and account execution. |
| Default confirmation modals | Enabled | Preserve the existing visible confirmation for every approval and action. |
| Wallet creation | Dashboard says off; client config sets `createOnLogin: 'users-without-wallets'` | The app's `PrivyProvider` setting takes precedence for this integration: the pinned SDK describes this option as prompting after login when the user has no wallet. Review this separately if first-run Telegram onboarding is too long. |
| App session / refresh / signing key / access lifetimes | 90 days / 30 days / 60 minutes / 1 hour | No evidence these values control per-transaction signing latency; do not change them as an RPC optimization. |
| Accent color | Dashboard `#b9a0ff`; app sets `#7c5cff` | The React app appearance override wins for its Privy UI. |
| Logo | Dashboard currently uses a Twitter JPG | Optional branding cleanup only; unrelated to execution latency. |

The app configuration is in [`PrivyClientProvider.tsx`](../apps/mini-app/src/components/PrivyClientProvider.tsx). It passes `mainnet` and `base` as `supportedChains`, keeps the embedded-wallet signing UIs on, and enables wallet creation for users who do not already have a wallet. `WalletSection.tsx` also offers an explicit wallet creation action.

## What the pinned SDK supports for RPCs

`PrivyClientConfig` in the installed 3.45.0 type declarations has **no Ethereum `rpcs` or transport option**. The `rpcs` property appears under `solana` only and is typed for Solana Kit RPC clients. Therefore the app's `getRpcTransport` cannot be passed into the Ethereum `PrivyProvider`.

There is a separate supported Ethereum override: the package exports `addRpcUrlOverrideToChain(chain, rpcUrl)`. The bundled `@privy-io/chains` 0.6.1 type declaration documents this helper and a `rpcUrls.privyWalletOverride` chain property. Privy's installed resolver reads `privyWalletOverride.http[0]` ahead of its configured/managed RPC and the chain defaults. This is a **single URL**, not an ordered fallback transport. The provider's chain override would bypass the app's tested endpoint rotation, chain-ID probe, and cooldown behavior; selecting only the first Alchemy URL would reduce resilience when that endpoint is unavailable. For that reason, keep `supportedChains` unchanged and leave Privy's internal RPC route managed by Privy.

FxAeon's controlled reads use the shared, chain-verified fallback in [`clients.ts`](../apps/mini-app/src/lib/fx/clients.ts) and [`config.ts`](../apps/mini-app/src/lib/fx/config.ts); the official SDK route uses the bounded fallback input wired in [`sdk.ts`](../apps/mini-app/src/lib/fx/sdk.ts). Embedded-wallet signing continues through `useSendTransaction` with an explicit address and visible modal. External-wallet requests go to that wallet's EIP-1193 provider. Those are separate RPC paths; the shared application transport does not replace either wallet's signing authority.

## Practical next step

### Approval-to-action prompts

The pinned SDK resolves `sendTransaction` with a hash on broadcast while its submitted screen can remain open. FxAeon now records that hash immediately and waits for the prior embedded-wallet screen to close before preparing the next transaction prompt. The runner performs its remaining-route simulation, nonce/chain checks and fee refresh after this wait. The wait is bounded, aborts on wallet/session changes, and never applies to external wallets. A timeout preserves the confirmed approval for a fresh review rather than reporting the intended action as complete. Confirmation screens remain enabled. Adapter and runner regressions cover the ordering; this establishes the local integration behavior, not a measured end-to-end Telegram latency claim.

### Wallet export

FxAeon's export handler calls `exportWallet({ address: embedded.address })` directly; it does not call login or reconnect first. The installed Privy 3.45.0 export hook itself opens `EmbeddedWalletConnectingScreen`, sets `shouldForceMFA: true`, and then navigates to `EmbeddedWalletKeyExportScreen`. Consequently, seeing a connecting screen during export does not by itself mean the app lost its authenticated session. It is Privy's secure export initialization. A stuck screen still needs reproduction in Telegram; do not remove its authentication step or replace the isolated export UI to hide that transition.

Local implementation evidence: `apps/mini-app/node_modules/@privy-io/react-auth/dist/esm/use-export-wallet-Dsuleueq.mjs` and `apps/mini-app/src/components/WalletSection.tsx`.

Keep this optimization focused on the shared fallback already used by FxAeon reads, fees, and SDK planning. There is no Privy EVM hook in 3.45.0 for injecting that failover transport, and adding an app-owned proxy solely to override Privy's internal endpoint would add infrastructure and another critical path.

For a future latency experiment, evaluate an opt-in EIP-7702/native-gas route that batches eligible calls, including any approval/action pair the protocol can safely execute atomically. Privy's current gas docs say its EVM native-gas sponsorship uses EIP-7702 and paymasters, upgrades the embedded wallet to a smart contract, and can carry a convenience fee; the docs distinguish this from its separate ERC-4337 smart-wallet product. This is a transaction-model and user-consent change, not an automatic consequence of TEE and not a routine RPC setting. Benchmark it as a separate opt-in pilot; do not migrate wallet types or enable sponsorship as part of this RPC fix.

## Evidence

- Pinned local package: `apps/mini-app/node_modules/@privy-io/react-auth/package.json` → `3.45.0`; `dist/dts/types-CgWBevVE.d.ts` → `PrivyClientConfig` has `supportedChains`, `defaultChain`, `embeddedWallets`, and `solana.rpcs` only.
- Pinned local package: `node_modules/.pnpm/@privy-io+chains@0.6.1/node_modules/@privy-io/chains/dist/dts/index.d.ts` documents `addRpcUrlOverrideToChain`, `privyWalletOverride`, and `RpcConfig.rpcUrls` as a chain-ID-to-single-URL map. The helper is re-exported by Privy React Auth 3.45.0.
- Pinned local implementation: `apps/mini-app/node_modules/@privy-io/react-auth/dist/cjs/getPublicClient-CrkRktPd.js` resolves the Ethereum endpoint in this order: chain `privyWalletOverride`, SDK `rpcConfig` entry, chain Privy proxy, then public/default endpoint. In this package, the SDK's `rpcConfig` is internal app configuration, not a `PrivyProvider` client option.
- [Privy gas sponsorship overview](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview) describes EVM native gas sponsorship, supported networks (including Ethereum and Base), EIP-7702 behavior, and fee calculation.
- [Privy React send-transaction docs](https://docs.privy.io/guide/react/wallets/embedded/prompts/transact) documents `useSendTransaction`, the address option, per-call `uiOptions`, and that hiding wallet UIs hides the confirmation UI. FxAeon must keep its explicit user confirmation.
- [Privy wallet creation docs](https://docs.privy.io/wallets/connectors/usage/connect-or-create) describes the user-facing connect-or-create flow. The precise `createOnLogin` behavior is documented in the installed 3.45.0 `PrivyClientConfig` declaration.
