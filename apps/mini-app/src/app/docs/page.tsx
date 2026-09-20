'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { AppShell } from '@/components/ui';
import styles from './Docs.module.css';

const sections = [
  { id: 'overview', label: 'Overview', keywords: 'sdk f(x) protocol networks portfolio supported actions' },
  { id: 'getting-started', label: 'Getting started', keywords: 'connect wallet review approve onboarding transaction' },
  { id: 'access', label: 'Browser & Telegram', keywords: 'browser telegram mini app launch authentication email' },
  { id: 'wallets', label: 'Wallets & signing', keywords: 'wallet signer private key security approval transaction' },
  { id: 'trade', label: 'Trade & leverage', keywords: 'eth btc long short leverage market price chart' },
  { id: 'positions', label: 'Position management', keywords: 'collateral debt close reduce increase adjust value' },
  { id: 'earn', label: 'Earn', keywords: 'fxsave usdc fxusd deposit withdraw redeem claim cooldown vault' },
  { id: 'borrow', label: 'Borrow', keywords: 'fxusd collateral debt mint repay liquidation safety withdraw' },
  { id: 'move', label: 'Move between chains', keywords: 'bridge ethereum base layerzero recipient fxusd fxsave' },
  { id: 'fees', label: 'Fees & slippage', keywords: 'gas network fee native quote slippage price' },
  { id: 'history', label: 'History & recovery', keywords: 'history journal receipt hash pending submitted confirming completed failed cancelled signature' },
  { id: 'privacy', label: 'Privacy & risks', keywords: 'privacy risk contract custody storage wallet chain' },
  { id: 'troubleshooting', label: 'Troubleshooting', keywords: 'wallet review bridge pending error' },
] as const;

export default function DocsPage() {
  const [search, setSearch] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(true);
  const [activeSection, setActiveSection] = useState<string>('overview');
  const normalizedSearch = search.trim().toLowerCase();
  const visibleSections = useMemo(
    () => normalizedSearch
      ? sections.filter((section) => `${section.label} ${section.keywords}`.toLowerCase().includes(normalizedSearch))
      : sections,
    [normalizedSearch],
  );

  useEffect(() => {
    setHydrated(true);
    const media = window.matchMedia('(max-width: 760px)');
    const syncContents = () => setContentsOpen(!media.matches);
    syncContents();
    media.addEventListener('change', syncContents);
    const scrollRoot = document.querySelector('.app-content');
    const sectionObserver = new IntersectionObserver((entries) => {
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (current?.target.id) setActiveSection(current.target.id);
    }, {
      root: scrollRoot,
      rootMargin: '-12% 0px -72% 0px',
      threshold: 0,
    });
    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) sectionObserver.observe(element);
    });
    const scrollToCurrentSection = () => {
      const encodedId = window.location.hash.slice(1);
      if (!encodedId) return;
      let id = encodedId;
      try {
        id = decodeURIComponent(encodedId);
      } catch {
        // Leave malformed hashes addressable without breaking the page.
      }
      if (!id) return;
      const scroll = () => document.getElementById(id)?.scrollIntoView({ block: 'start' });
      if (media.matches) {
        setContentsOpen(true);
        // Opening the disclosure changes the document offset; scroll after layout settles.
        requestAnimationFrame(() => requestAnimationFrame(scroll));
      } else {
        scroll();
      }
    };
    const restoreHashPosition = () => {
      requestAnimationFrame(() => requestAnimationFrame(scrollToCurrentSection));
      void document.fonts.ready.then(scrollToCurrentSection);
    };

    restoreHashPosition();
    window.addEventListener('hashchange', restoreHashPosition);
    return () => {
      window.removeEventListener('hashchange', restoreHashPosition);
      media.removeEventListener('change', syncContents);
      sectionObserver.disconnect();
    };
  }, []);

  return (
    <AppShell>
      <div className={styles.docsPage}>
        <div className={styles.docsLayout}>
          <nav className={styles.docsNav} aria-label="Documentation sections" aria-busy={!hydrated}>
            <label className={styles.searchLabel} htmlFor="docs-search">Search docs</label>
            <div className={styles.searchRow}>
              <Search className={styles.searchIcon} aria-hidden="true" />
              <input
                id="docs-search"
                type="search"
                value={search}
                onChange={(event) => {
                  const value = event.target.value;
                  setSearch(value);
                  if (value.trim()) setContentsOpen(true);
                }}
                disabled={!hydrated}
                placeholder="Search"
                className={styles.searchInput}
                autoComplete="off"
              />
              {search && <button type="button" className={styles.clearSearch} onClick={() => setSearch('')}>Clear</button>}
            </div>
            <details
              className={styles.contentsDisclosure}
              open={contentsOpen}
              onToggle={(event) => setContentsOpen(event.currentTarget.open)}
            >
              <summary className={styles.contentsSummary}>
                <span>Contents</span>
                <span className={styles.contentsCount} aria-live="polite">
                  {visibleSections.length === 0 ? 'No matches' : `${visibleSections.length} ${visibleSections.length === 1 ? 'section' : 'sections'}`}
                </span>
                <span className={styles.contentsChevron} aria-hidden="true" />
              </summary>
              <div className={styles.navLinks}>
                {visibleSections.map((section) => <a key={section.id} href={`#${section.id}`} onClick={() => setActiveSection(section.id)} aria-current={activeSection === section.id ? 'location' : undefined} className={styles.navLink}>{section.label}</a>)}
              </div>
              {visibleSections.length === 0 && <p className={styles.emptySearch}>Try “wallet”, “bridge”, or “slippage”.</p>}
            </details>
          </nav>

          <div className={styles.docsContent}>
            <header className={styles.docsIntro}>
              <h1 id="docs-page-heading">Docs</h1>
            </header>

            <section id="overview" className={`${styles.section} ${activeSection === 'overview' ? styles.sectionActive : ''}`}>
              <h2>Overview</h2>
              <p>Trade ETH and BTC, earn with fxSAVE, and borrow fxUSD on Ethereum. Move fxUSD and fxSAVE between Ethereum and Base.</p>
              <p>FxAeon uses the official f(x) SDK for supported protocol reads and transaction plans. For protocol design and contract details, read the <a href="https://fxprotocol.gitbook.io/fx-docs" target="_blank" rel="noopener noreferrer">f(x) protocol docs</a>.</p>
            </section>

            <section id="getting-started" className={`${styles.section} ${activeSection === 'getting-started' ? styles.sectionActive : ''}`}>
              <h2>Getting started</h2>
              <ol>
                <li>Open FxAeon in a supported browser or Telegram. The app workspace starts on Portfolio.</li>
                <li>Connect your wallet, then choose Trade, Earn, Borrow, or Move.</li>
                <li>Enter the amount and check the asset, network, recipient, output, and fees.</li>
                <li>Confirm each transaction in your wallet. Each step continues after its matching receipt is verified.</li>
              </ol>
            </section>

            <section id="access" className={`${styles.section} ${activeSection === 'access' ? styles.sectionActive : ''}`}>
              <h2>Browser & Telegram</h2>
              <p>The web app and Telegram Mini App offer the same actions. Telegram adds native sizing, haptics, and navigation.</p>
              <p>Use Connect wallet to sign in with email or an existing wallet, on the web or in Telegram. Each transaction requires confirmation in your selected wallet.</p>
            </section>

            <section id="wallets" className={`${styles.section} ${activeSection === 'wallets' ? styles.sectionActive : ''}`}>
              <h2>Wallets & signing</h2>
              <p>Your connected wallet supplies the sender. FxAeon does not receive or store private keys.</p>
              <p>A transaction may need more than one approval. If its terms change before signing, review the updated details and choose the action again.</p>
              <div className={styles.callout}><p><strong>Before approval:</strong> confirm the address, network, recipient, amount, contract, and any approval request in your wallet.</p></div>
            </section>

            <section id="trade" className={`${styles.section} ${activeSection === 'trade' ? styles.sectionActive : ''}`}>
              <h2>Trade & leverage</h2>
              <p>Trade supports ETH and BTC long and short positions on Ethereum. Choose an input asset, amount, side, and leverage. The market panel shows current price and 1H, 1D, 7D, and 30D charts.</p>
              <p>Action details show the transaction steps, minimum output, approvals, and slippage. Before opening your wallet, the app checks and simulates the displayed action. If the preview expires or signing-relevant details change, review the updated details and choose the action again.</p>
            </section>

            <section id="positions" className={`${styles.section} ${activeSection === 'positions' ? styles.sectionActive : ''}`}>
              <h2>Position management</h2>
              <p>Positions are read from Ethereum and show market, side, collateral, debt, and leverage. Increase, reduce, close, or adjust leverage when the selected action supports it.</p>
              <p>Cards show a reference market price and estimated collateral and debt. These are display values, not health, P&amp;L, ROI, entry, or liquidation metrics.</p>
              <p>When display prices are validated, <strong>position value</strong> is estimated collateral value minus debt in USD. It is a display estimate, not a liquidation value or execution quote. Unavailable values stay blank or show a loading skeleton while available position data remains visible.</p>
              <p>After a transaction, the app rereads state. Stale data can block an action until the current position and plan are available.</p>
            </section>

            <section id="earn" className={`${styles.section} ${activeSection === 'earn' ? styles.sectionActive : ''}`}>
              <h2>Earn with fxSAVE</h2>
              <p>Earn reads fxSAVE balances, vault value, redemption status, and claimable amounts from Ethereum. Its actions are deposit, withdraw, and claim.</p>
              <p>Deposit supports fxUSD and USDC. Forms show the selected wallet’s verified balance, and token pickers pair quantity with estimated USD worth. Unavailable balances remain unknown, never zero; fxSAVE remains the withdrawal limit.</p>
              <p>Withdrawals may be instant or queued. Queued redemptions remain pending through cooldown and expose Claim when ready. Action details show the transaction steps, slippage, and the instant-redemption fee when applicable.</p>
            </section>

            <section id="borrow" className={`${styles.section} ${activeSection === 'borrow' ? styles.sectionActive : ''}`}>
              <h2>Borrow fxUSD</h2>
              <p>Borrow manages a long ETH or BTC collateral position. Deposit collateral and mint fxUSD, or repay fxUSD and withdraw collateral. The position selector keeps collateral and debt context visible.</p>
              <p>Fields show the selected wallet’s verified Ethereum balance when available. Pending reads stay distinct from zero. Withdrawable collateral is limited by the selected position and contract rules.</p>
              <p>Review the action details before signing. Withdrawing collateral can reduce the safety margin and increase liquidation risk.</p>
            </section>

            <section id="move" className={`${styles.section} ${activeSection === 'move' ? styles.sectionActive : ''}`}>
              <h2>Move between chains</h2>
              <p>Move bridges supported fxUSD and fxSAVE between Ethereum and Base through the f(x) bridge. Choose direction, asset, amount, and recipient. The connected wallet signs the transfer and pays its required fees; the recipient defaults to that wallet.</p>
              <p>Supported actions are checked against the selected chain, asset, balance, bridge connection, fee quote, and recipient. Advanced bridge mode exposes token and deployment fields for expert users. Ethereum may require one approval before the send.</p>
              <div className={styles.callout}><p><strong>Before approval:</strong> check both networks, token identity, recipient, amount, and fee. Source confirmation and destination delivery are separate states; FxAeon verifies matching LayerZero events.</p></div>
            </section>

            <section id="fees" className={`${styles.section} ${activeSection === 'fees' ? styles.sectionActive : ''}`}>
              <h2>Fees & slippage</h2>
              <p>Move shows the current LayerZero fee quote. Other actions show estimated gas and network cost when data is available; Base may add network and operator fees. Unavailable estimates stay labelled.</p>
              <p>Slippage presets are 0.1%, 0.5%, 1%, and 2% for Trade, Positions, and applicable fxSAVE actions. Borrow and Move use their action defaults. Lower tolerance can fail; higher tolerance allows a lower minimum output.</p>
              <p>USD values and charts are display data. Execution follows the live protocol quote and contract checks.</p>
            </section>

            <section id="history" className={`${styles.section} ${activeSection === 'history' ? styles.sectionActive : ''}`}>
              <span id="recovery" aria-hidden="true" />
              <h2>History & recovery</h2>
              <p>History keeps drafts separate from submitted transactions. A draft is saved just before FxAeon asks your wallet to sign; it does not prove a wallet prompt opened or a transaction was submitted. Continue restores saved form values into a fresh review, never executable data. Connecting or refreshing never opens a wallet prompt.</p>
              <p>After a transaction hash is returned, FxAeon saves it on this device and checks the matching receipt and mined transaction details. A step is complete after its receipt is verified. This record is not a complete blockchain history.</p>
              <p>History checks the selected wallet and chain and never resends automatically. Inspect partially completed actions and wait for separate bridge delivery verification before retrying.</p>
            </section>

            <section id="privacy" className={`${styles.section} ${activeSection === 'privacy' ? styles.sectionActive : ''}`}>
              <h2>Privacy & risks</h2>
              <p><a href="/privacy.html">How FxAeon handles your data</a></p>
              <ul>
                <li>FxAeon has no account server, delegated signer, background executor, or private-key field. Your wallet approves each transaction.</li>
                <li>Theme, slippage, and recovery hints are stored on this device and reread against chain state.</li>
                <li>Review the address, network, contract, amount, recipient, and approval in every wallet prompt.</li>
                <li>Contract outcomes and liquidation risk are determined by the protocol and network. Wallets, network services, token contracts, bridges, and chains remain external dependencies.</li>
              </ul>
            </section>

            <section id="troubleshooting" className={`${styles.section} ${activeSection === 'troubleshooting' ? styles.sectionActive : ''}`}>
              <h2>Troubleshooting</h2>
              <h3>Wallet is not available</h3>
              <p>Wait for the wallet to load, reload if the screen reports a timeout, or reopen the Mini App from Telegram’s bot menu. Confirm that the wallet is connected and selected.</p>
              <h3>The action button is disabled</h3>
              <p>Check that an amount is positive, the amount format is valid for the selected token, the selected position is current, and any slippage or leverage value is within the displayed bounds.</p>
              <h3>The action stopped or a receipt is unclear</h3>
              <p>Read the status and History entry. A rejection, failed transaction, changed account, timeout, or receipt that does not match stops later steps. Do not resubmit until the wallet and chain state are understood.</p>
              <h3>Sent but not received</h3>
              <p>Keep the History entry open. A source transaction can confirm before destination funds arrive; FxAeon checks delivery separately.</p>
            </section>

            <footer className={styles.docsFooter}>
              Check current contract, network, quote, and wallet details when you act.
              <nav className={styles.footerLinks} aria-label="Documentation links">
                <Link href="/" className="text-mint underline underline-offset-2">Portfolio</Link>
                <Link href="/more" className="text-mint underline underline-offset-2">More</Link>
                <a href="https://fxprotocol.gitbook.io/fx-docs" target="_blank" rel="noopener noreferrer" className="text-mint underline underline-offset-2">f(x) protocol docs</a>
              </nav>
            </footer>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
