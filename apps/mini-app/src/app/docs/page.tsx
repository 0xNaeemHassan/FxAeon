'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/ui';
import styles from './Docs.module.css';

const sections = [
  { id: 'overview', label: 'Overview', keywords: 'sdk scope networks capabilities' },
  { id: 'getting-started', label: 'Getting started', keywords: 'connect wallet review approve onboarding' },
  { id: 'access', label: 'Browser & Telegram', keywords: 'browser telegram mini app launch authentication' },
  { id: 'wallets', label: 'Wallets & signing', keywords: 'privy signer private key security' },
  { id: 'trade', label: 'Trade & leverage', keywords: 'eth btc long short leverage market' },
  { id: 'positions', label: 'Position management', keywords: 'collateral debt close reduce increase' },
  { id: 'earn', label: 'Earn', keywords: 'fxsave deposit withdraw redeem claim cooldown' },
  { id: 'borrow', label: 'Borrow', keywords: 'fxusd collateral debt mint repay liquidation safety' },
  { id: 'move', label: 'Move between chains', keywords: 'bridge ethereum base oft layerzero recipient' },
  { id: 'fees', label: 'Fees & slippage', keywords: 'gas network fee native quote slippage coingecko defillama oracle price' },
  { id: 'recovery', label: 'Recovery', keywords: 'activity journal receipt hash pending' },
  { id: 'privacy', label: 'Privacy & risks', keywords: 'privacy risk contract custody storage' },
  { id: 'troubleshooting', label: 'Troubleshooting', keywords: 'wallet review bridge pending error' },
] as const;

export default function DocsPage() {
  const [search, setSearch] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleSections = useMemo(
    () => normalizedSearch
      ? sections.filter((section) => `${section.label} ${section.keywords}`.toLowerCase().includes(normalizedSearch))
      : sections,
    [normalizedSearch],
  );

  useEffect(() => {
    setHydrated(true);
    const scrollToCurrentSection = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    };
    const restoreHashPosition = () => {
      requestAnimationFrame(() => requestAnimationFrame(scrollToCurrentSection));
      void document.fonts.ready.then(scrollToCurrentSection);
    };

    restoreHashPosition();
    window.addEventListener('hashchange', restoreHashPosition);
    return () => window.removeEventListener('hashchange', restoreHashPosition);
  }, []);

  return (
    <AppShell title="Docs" subtitle="A practical guide to using FxAeon.">
      <div className={styles.docsPage}>
        <div className={styles.docsLayout}>
          <nav className={styles.docsNav} aria-label="Documentation sections" aria-busy={!hydrated}>
            <label className={styles.searchLabel} htmlFor="docs-search">Search docs</label>
            <div className={styles.searchRow}>
              <input
                id="docs-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={!hydrated}
                placeholder="Search sections"
                className={styles.searchInput}
                autoComplete="off"
              />
              {search && <button type="button" className={styles.clearSearch} onClick={() => setSearch('')}>Clear</button>}
            </div>
            <span className={styles.navLabel}>On this page</span>
            <div className={styles.navLinks}>
              {visibleSections.map((section) => <a key={section.id} href={`#${section.id}`} className={styles.navLink}>{section.label}</a>)}
            </div>
            <p className={styles.resultCount} aria-live="polite">
              {visibleSections.length === 0 ? 'No sections found' : `${visibleSections.length} ${visibleSections.length === 1 ? 'section' : 'sections'}`}
            </p>
            {visibleSections.length === 0 && <p className={styles.emptySearch}>Try “wallet”, “bridge”, or “slippage”.</p>}
          </nav>

          <div className={styles.docsContent}>
            <header className={styles.docsIntro}>
              <p className={styles.kicker}>FxAeon documentation</p>
              <h2>Use your wallet.<br />Understand every route.</h2>
              <p className={styles.introCopy}>FxAeon is a focused interface for f(x) positions, fxSAVE, fxUSD borrowing, and Ethereum–Base movement. This guide explains what the app does, what your wallet approves, and where to look when an action needs attention.</p>
              <div className={styles.factGrid} aria-label="FxAeon scope">
                <div className={styles.fact}><strong>Two networks</strong><span>Ethereum and Base</span></div>
                <div className={styles.fact}><strong>Wallet-first</strong><span>Every write is explicitly approved</span></div>
                <div className={styles.fact}><strong>Read before write</strong><span>Routes are rebuilt and checked before signing</span></div>
                <div className={styles.fact}><strong>Focused scope</strong><span>Trade, save, borrow, and move</span></div>
              </div>
            </header>

            <section id="overview" className={styles.section}>
              <h2>Overview</h2>
              <p>FxAeon prepares each action, shows what your wallet will approve, and asks the selected wallet to approve every transaction. Ethereum is the source of truth for positions and fxSAVE state. Base is supported for moving assets between chains.</p>
              <p>Portfolio reads supported Ethereum assets, including FXN, and adds a USD estimate only when that asset has a validated current price. The interface deliberately does not provide spot swaps, an order book, limit orders, automated execution, or a server account. Prices and charts help you read the screen; they are not execution inputs.</p>
              <details className={styles.callout}>
                <summary className="cursor-pointer text-[14px] font-semibold text-[var(--text)]">Supported protocol actions</summary>
                <p>For technical reference, FxAeon uses these reviewed f(x) methods:</p>
                <ul>
                  <li><code>getPositions</code>, <code>increasePosition</code>, <code>reducePosition</code>, <code>adjustPositionLeverage</code></li>
                  <li><code>depositAndMint</code>, <code>repayAndWithdraw</code></li>
                  <li><code>getBridgeQuote</code>, <code>buildBridgeTx</code></li>
                  <li><code>getFxSaveBalance</code>, <code>getFxSaveConfig</code>, <code>getFxSaveRedeemStatus</code>, <code>getFxSaveClaimable</code>, <code>getRedeemTx</code>, <code>depositFxSave</code>, <code>withdrawFxSave</code></li>
                </ul>
              </details>
            </section>

            <section id="getting-started" className={styles.section}>
              <h2>Getting started</h2>
              <ol>
                <li>Open FxAeon in a supported browser or from the Telegram Mini App.</li>
                <li>Connect or choose the wallet you want to use. Check the address shown in the wallet profile.</li>
                <li>Start with Portfolio to inspect verified positions, or choose Trade, Earn, Borrow, or Move.</li>
                <li>Enter an amount, open the review, and read the network, wallet, amounts, approvals, and transaction steps.</li>
                <li>Acknowledge the review, then approve each wallet request. The next step waits for the prior receipt.</li>
              </ol>
            </section>

            <section id="access" className={styles.section}>
              <h2>Browser & Telegram</h2>
              <p>The web app and Telegram Mini App offer the same FxAeon actions. Telegram adds native sizing, haptics, and navigation, while your selected wallet still approves transactions.</p>
              <p>When Privy is available, it supports login and wallet controls inside Telegram. On the web, you can explicitly connect a supported browser wallet.</p>
            </section>

            <section id="wallets" className={styles.section}>
              <h2>Wallets & signing</h2>
              <p>The address shown by your selected Privy or browser wallet is always used as the sender. FxAeon does not receive or store private keys.</p>
              <div className={styles.callout}><p><strong>Before you approve:</strong> confirm the wallet address, network, recipient, amount, contract, and approval spender. Technical calldata, selector, value, and nonce are available in the review disclosure.</p></div>
            </section>

            <section id="trade" className={styles.section}>
              <h2>Trade & leverage</h2>
              <p>Trade supports Ethereum ETH and BTC markets with long and short positions. You can choose an input asset, amount, side, and target leverage. The app reads each pool’s available leverage range and refreshes those limits while the SDK prices the route. If a pool limit changed, the target is moved inside the new range and review stops so you can check it again.</p>
              <p>Trade is not a general exchange: there is no spot swap, limit order, order book, or background strategy. Use the review to see the route, minimum-output information, approvals, and any slippage setting before signing. Confirm rebuilds the selected SDK route against current state; if its calldata, minimum output, quote, or other reviewed fact changed, FxAeon shows the refreshed route and requires a new acknowledgement before opening the wallet.</p>
            </section>

            <section id="positions" className={styles.section}>
              <h2>Position management</h2>
              <p>Positions are read from Ethereum and shown with their market, side, collateral, debt, and leverage context. A position can be increased, reduced, closed, or adjusted to a new leverage target when the selected route supports it.</p>
              <p>When validated display prices are available, <strong>estimated net equity</strong> is calculated as collateral value in USD minus debt value in USD. It is a display estimate, not a liquidation value, P&amp;L, close quote, oracle value, or guarantee of what a transaction will return. A missing price is shown as unavailable; retained stale position data remains visible with an explicit Last verified label, and stale prices are labelled Last prices.</p>
              <p>Refreshing is important after a write. A stale or partially unavailable position is not treated as a safe live quote, and the app can block review until state is read again. Increasing or adjusting a position applies the same live leverage-limit and fresh-route checks used when opening one.</p>
            </section>

            <section id="earn" className={styles.section}>
              <h2>Earn with fxSAVE</h2>
              <p>Earn reads your fxSAVE balance, its current underlying pool-token amount when available, vault configuration, redemption status, and claimable preview from Ethereum. Deposits support USDC, fxUSD, and the fxUSD pool token.</p>
              <p>Deposit forms show the selected wallet’s verified available balance for each supported input. Token pickers pair the available quantity with its estimated USD worth, not the price of one token. A balance can be loading or unavailable when Ethereum does not respond; that state is never treated as zero. Your fxSAVE balance remains the authoritative withdrawal limit.</p>
              <p>Withdrawals can be instant or queued where the selected asset supports that path. A queued redemption remains pending through its cooldown; claim review becomes available when the current redemption state says it is ready. Final review shows the selected route and slippage when applicable. Earn displays the configured instant-redemption fee before review.</p>
            </section>

            <section id="borrow" className={styles.section}>
              <h2>Borrow fxUSD</h2>
              <p>Borrow creates or manages a long collateral position in the ETH or BTC market. Deposit collateral and mint fxUSD, or repay fxUSD and withdraw collateral. The position selector keeps collateral and debt context visible before a review.</p>
              <p>Collateral and fxUSD repayment fields show the selected wallet’s verified Ethereum balance when available. Loading or unavailable reads are kept distinct from a verified zero. A collateral withdrawal is limited by the selected position and its contract rules, not by the wallet’s free-token balance.</p>
              <p>Leaving an amount at zero is supported for the one-sided action shown by the form. Withdrawing collateral can reduce the position’s safety margin and increase liquidation risk under the protocol’s contract rules. FxAeon does not promise a liquidation buffer; read the current collateral, debt, and reviewed route carefully before signing.</p>
            </section>

            <section id="move" className={styles.section}>
              <h2>Move between chains</h2>
              <p>Move bridges supported fxUSD and fxSAVE assets between Ethereum and Base through the f(x) bridge. Choose the direction, asset, amount, and recipient. If you are disconnected, the recipient control opens the wallet selector without leaving Move. The connected wallet remains the source signer and fee-refund address. The destination recipient defaults to that wallet, but you can explicitly choose another recipient.</p>
              <p>Standard Move forms read available balances on the selected source chain: Ethereum uses the underlying approval token, while Base uses the configured source OFT. Advanced custom contracts do not show an available balance; review their metadata, quote, and route checks before signing.</p>
              <p>Standard routes use configured addresses. Advanced OFT mode is for explicitly entered checksummed contracts and requires current validation and quote checks in both directions. Ethereum may require one exact approval before the OFT send.</p>
              <div className={styles.callout}><p><strong>Bridge risk:</strong> check the source network, destination network, recipient, and token identity. A confirmed source transaction is not the same as delivered destination funds. FxAeon verifies matching LayerZero events from the captured destination baseline block; custom OFTs add contract and peer risk.</p></div>
            </section>

            <section id="fees" className={styles.section}>
              <h2>Fees & slippage</h2>
              <p>Move bridge reviews include the current native LayerZero fee quote. Other routes can show a native transaction value when the SDK returns one, but FxAeon does not present a universal gas forecast. Protocol, redemption, or route-specific charges are surfaced when the SDK returns them; FxAeon does not invent a fee estimate.</p>
              <p>Slippage is a device-local preference used by Trade, Positions, and routed or instant fxSAVE forms. Presets are 0.1%, 0.5%, 1%, and 2%. Borrow uses its guarded route default; Move uses the bridge route’s quoted minimum delivery. Direct pool-token and queued fxSAVE paths omit a user slippage value. Lower tolerance can make a route fail; higher tolerance permits a worse minimum output. Slippage protection is not a promise about price.</p>
              <p>USD values and charts are display-only. Current display prices are primarily validated from DefiLlama; a bounded CoinGecko contract-price fallback can fill independently validated missing token quotes. Quotes older than 15 minutes are rejected, and FxAeon never substitutes a stablecoin peg. ETH/BTC history is separately validated from CoinGecko. Execution uses on-chain route data, oracle behavior, and contract checks, not these display feeds.</p>
            </section>

            <section id="recovery" className={styles.section}>
              <h2>Recovery</h2>
              <p>After your wallet returns a transaction hash, FxAeon saves it on this device so Activity can check the receipt again. This saved record is not a complete blockchain history or proof of balance, position, delivery, or authorization.</p>
              <p>Activity reconciles hashes against the selected wallet and chain. It never resends automatically. If a route partially completes, do not repeat the full action; inspect each step and the current on-chain state. For a bridge, wait for separate destination delivery verification.</p>
            </section>

            <section id="privacy" className={styles.section}>
              <h2>Privacy & risks</h2>
              <ul>
                <li>No FxAeon server account, delegated signer, background executor, or private-key field exists.</li>
                <li>Theme, slippage, and recovery hints are device-local storage. Local values can be stale or manipulated and are reread against chain truth.</li>
                <li>Wallet prompts remain the signing boundary. Review every contract, selector, amount, recipient, approval, and network.</li>
                <li>Contract and liquidation outcomes are determined on-chain. Do not treat a UI preview, USD display, or safety label as a guarantee.</li>
                <li>Public RPC, wallet connector, SDK, token contracts, bridge infrastructure, and the underlying chains remain external trust dependencies.</li>
              </ul>
            </section>

            <section id="troubleshooting" className={styles.section}>
              <h2>Troubleshooting</h2>
              <h3>Wallet is not available</h3>
              <p>Wait for the wallet provider, reload if the screen reports a timeout, or reopen the Mini App from Telegram’s bot menu. Confirm that the wallet is connected and selected.</p>
              <h3>The review button is disabled</h3>
              <p>Check that an amount is positive, the input is valid for the token decimals, the selected position is current, and any slippage or leverage value is within the displayed bounds.</p>
              <h3>The route stopped or a receipt is unclear</h3>
              <p>Read the status and Activity entry. A rejection, revert, nonce drift, timeout, or unmatched receipt stops later steps. Do not resubmit until the wallet and chain state are understood.</p>
              <h3>A bridge is source-confirmed but not delivered</h3>
              <p>Keep the Activity entry. Destination delivery is checked separately using the reviewed LayerZero identifiers and recipient; source confirmation alone is not proof of arrival.</p>
            </section>

            <footer className={styles.docsFooter}>
              FxAeon’s documentation describes the active client surface. Contract behavior, network state, quotes, and wallet prompts remain authoritative at the time of each action.
              <span className="ml-1"><Link href="/more" className="text-mint underline underline-offset-2">Back to More</Link></span>
            </footer>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
