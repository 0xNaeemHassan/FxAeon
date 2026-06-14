import type { Messages } from './config';

/** English — source of truth. Every other locale mirrors these keys. */
const en: Messages = {
  // -- nav (bottom tab bar) --
  'nav.home': 'Home',
  'nav.trade': 'Trade',
  'nav.deposit': 'Deposit',
  'nav.settings': 'Settings',

  // -- common --
  'common.openBot': 'Open @{bot}',
  'common.openInTelegram': 'Open in Telegram',
  'common.copyAddress': 'Copy address',
  'common.copied': 'Copied!',
  'common.save': 'Save changes',
  'common.saved': 'Saved',
  'common.back': 'Back',
  'common.retry': 'Retry',
  'common.loading': 'Loading f(x) Protocol trading…',
  'common.unknownError': 'Unknown error',

  // -- browser splash (app/page.tsx) --
  'splash.tagline':
    'Non-custodial leveraged trading on f(x) Protocol, built for Telegram. This app runs inside the FxAeon bot.',

  // -- login gates (app/login/page.tsx) --
  'loginGate.tgTitle': 'FxAeon runs inside Telegram',
  'loginGate.tgBody': 'Open the bot and send /start to set up your wallet.',
  'loginGate.notConfTitle': 'Wallet service not configured',
  'loginGate.notConfBody':
    'This build is missing its Privy app id, so wallet setup can’t run. If you’re the operator: set NEXT_PUBLIC_PRIVY_APP_ID (and NEXT_PUBLIC_PRIVY_SIGNER_ID for bot trading) and redeploy.',

  // -- onboarding intro (PrivyFlow intro screen) --
  'intro.titleLead': 'Trade f(x) like it’s',
  'intro.titleAccent': 'a message',
  'intro.subtitle': 'Create or import your own wallet — self-custody, no email, no compromise.',
  'intro.prop1Title': 'Your wallet, your keys',
  'intro.prop1Body':
    'Create a new wallet or import your own. Keys live in a secure enclave — exportable by you, invisible to us.',
  'intro.prop2Title': 'Trade from chat',
  'intro.prop2Body':
    'Open leveraged wstETH and WBTC positions with a message. Confirm in one tap.',
  'intro.prop3Title': 'You stay in control',
  'intro.prop3Body':
    'Bot trading is a permission YOU grant — and can revoke any time. Nothing signs without it.',
  'intro.referralPre': '🎁 Referral',
  'intro.referralPost': 'will be applied',
  'intro.ctaSetup': 'Set up my wallet',
  'intro.ctaConnecting': 'Connecting…',
  'intro.ctaMore': 'More sign-in options (Google, wallet…)',
  'intro.footer': 'Telegram login by default · Keys secured by hardware enclaves · Exportable any time',

  // -- portfolio --
  'portfolio.title': 'Portfolio',
  'portfolio.openInTgTitle': 'Open FxAeon in Telegram',
  'portfolio.openInTgBody': 'Your portfolio lives in the Telegram app.',
  'portfolio.degradedTitle': 'Live data isn’t available from this screen',
  'portfolio.degradedNoInit':
    'This launch type doesn’t carry Telegram credentials. Use /portfolio in the chat, or open the app from a bot button.',
  'portfolio.degradedNoBackend':
    'This build isn’t connected to the trading backend yet. Use /portfolio in the chat for live data.',
  'portfolio.loadFailTitle': 'Couldn’t load your account',
  'portfolio.walletLabel': 'Your wallet',
  'portfolio.selfCustodyBadge': 'self-custody',
  'portfolio.referralCode': 'Referral code',
  'portfolio.balances': 'Balances',
  'portfolio.balancesUnavailable':
    'On-chain balances are temporarily unavailable (RPC). Pull to refresh or try again shortly.',
  'portfolio.fundTitle': 'Fund your wallet to start trading.',
  'portfolio.fundBody': 'Send ETH, wstETH or WBTC to your address — then open your first position.',
  'portfolio.showDeposit': 'Show deposit address',
  'portfolio.positions': 'Positions',
  'portfolio.positionsIncomplete':
    'Some on-chain reads failed — positions shown may be incomplete. Refresh to retry.',
  'portfolio.noPositionsTitle': 'No open positions',
  'portfolio.noPositionsBody': 'Open a leveraged wstETH or WBTC position — it takes about 30 seconds.',
  'portfolio.setupTrade': 'Set up a trade',
  'portfolio.markets': 'Markets',
  'portfolio.pricesStale': 'Prices may be a few minutes old (upstream hiccup).',
  'portfolio.quickActions': 'Quick actions',
  'portfolio.qaTradeHint': 'Leverage up to 10x',
  'portfolio.qaDepositHint': 'ETH · wstETH · WBTC',
  'portfolio.qaSecurity': 'How your wallet is protected',
  'portfolio.qaSecurityHint': 'Self-custody, your keys',
  'portfolio.colCollateral': 'Collateral',
  'portfolio.colPnl': 'PnL',
  'portfolio.colHealth': 'Health',
  'portfolio.long': 'long',
  'portfolio.short': 'short',
  'portfolio.totalValue': 'Total Value',
  'portfolio.valueUnavailable': 'Live valuation unavailable',
  'portfolio.pnlUnrealized': 'unrealized PnL',
  'portfolio.tabPositions': 'Positions',
  'portfolio.tabFxusd': 'fxUSD',
  'portfolio.fxusdEmptyTitle': 'No fxUSD savings yet',
  'portfolio.fxusdEmptyBody': 'Deposit fxUSD into the Stability Pool (fxSAVE) with /save in the bot to earn yield — your position shows up here and counts toward Total Value.',
  'portfolio.savingsTitle': 'fxUSD Stability Pool',
  'portfolio.savingsShares': '{shares} shares',
  'portfolio.savingsRedeemReady': 'Ready to claim — run /claim',
  'portfolio.savingsRedeemPending': 'Withdrawal cooling down',
  'portfolio.savingsValuePending': 'Value updating',
  'portfolio.savingsIncomplete': "Couldn't load your savings just now — refresh to retry.",
  'portfolio.size': 'size',
  'portfolio.newPosition': 'New Position',

  // -- trade --
  'trade.title': 'Trade',
  'trade.subtitle': 'Leveraged positions on f(x) Protocol',
  'trade.upTo': 'up to {n}x',
  'trade.long': 'long',
  'trade.short': 'short',
  'trade.leverage': 'Leverage',
  'trade.maxSuffix': '{n}x max ({side})',
  'trade.collateral': 'Collateral ({market})',
  'trade.totalExposure': 'Total exposure ≈',
  'trade.reviewConfirm': 'Review & confirm in chat',
  'trade.confirmNote': 'The bot shows a signed preview — nothing executes until you confirm there.',
  'trade.reviewInChat': 'Review {lev}x {side} in chat',
  // -- in-app execution: review (screen 2) --
  'trade.review.title': 'Review Quote',
  'trade.review.heading': 'Open {side} — {market} {lev}x',
  'trade.review.youPay': 'You pay',
  'trade.review.youGet': 'Position size',
  'trade.review.minReceived': 'Min received',
  'trade.review.leverageNote': '~{lev}x leverage',
  'trade.review.entryPrice': 'Entry price',
  'trade.review.positionSize': 'Position size',
  'trade.review.borrowed': 'Borrowed',
  'trade.review.slippage': 'Slippage tolerance',
  'trade.review.mev': 'MEV Protection',
  'trade.review.networkFee': 'Network fee',
  'trade.review.gasMarket': 'Market',
  'trade.review.confirmSign': 'Confirm & Sign',
  'trade.review.quoting': 'Fetching live quote…',
  'trade.review.refresh': 'Refresh quote',
  'trade.review.on': 'ON',
  'trade.review.off': 'OFF',
  'trade.review.honestNote': 'Quote, gas and slippage are read live on-chain. Nothing is sent until you Confirm.',
  // -- gas detail (screen 3) --
  'trade.gas.title': 'Network fee',
  'trade.gas.subtitle': 'EIP-1559 • Ethereum mainnet',
  'trade.gas.maxBaseFee': 'Max base fee',
  'trade.gas.priorityFee': 'Priority fee',
  'trade.gas.gasLimit': 'Gas limit',
  'trade.gas.maxCost': 'Max cost',
  'trade.gas.speedTitle': 'Transaction speed',
  'trade.gas.tier.slow': 'Slow',
  'trade.gas.tier.market': 'Market',
  'trade.gas.tier.fast': 'Fast',
  'trade.gas.tierNote': 'Real Slow/Market/Fast priority tips from recent blocks. The server re-derives and broadcasts the tier you pick.',
  // -- executing / result (screen 5) --
  'trade.exec.signing': 'Opening position…',
  'trade.exec.signingNote': 'Simulating, signing and broadcasting. Do not close.',
  'trade.result.opened': 'Position opened',
  'trade.result.summary': '{market} {lev}x • {amount} {token} committed',
  'trade.result.transaction': 'Transaction',
  'trade.result.status': 'Status',
  'trade.result.block': 'Block',
  'trade.result.gasPaid': 'Gas paid',
  'trade.result.confirmations': 'Confirmations',
  'trade.result.confirmed': 'Confirmed',
  'trade.result.submitted': 'Submitted',
  'trade.result.broadcast': 'Broadcast',
  'trade.result.deduped': 'Already submitted (no duplicate sent)',
  'trade.result.viewEtherscan': 'View on Etherscan',
  'trade.result.done': 'Done',
  'trade.result.failedTitle': 'Could not open',
  'trade.result.tryAgain': 'Try again',
  'trade.result.enableTrading': 'Enable bot trading',
  'trade.result.enableNote': 'Grant the session signer in Settings, then retry.',

  // -- settings --
  'settings.title': 'Settings',
  'settings.subtitle': 'Synced with your bot account',
  'settings.openInTgTitle': 'Open FxAeon in Telegram',
  'settings.openInTgBody': 'Settings sync with your bot account.',
  'settings.cantSyncTitle': 'Settings can’t sync from this screen',
  'settings.cantSyncNoInit':
    'This launch type doesn’t carry Telegram credentials. Use /settings in the chat instead.',
  'settings.cantSyncNoBackend':
    'This build isn’t connected to the trading backend yet. Use /settings in the chat instead.',
  'settings.language': 'Language',
  'settings.maxSlippage': 'Max slippage',
  'settings.mevProtection': 'MEV protection',
  'settings.privateTx': 'Private transactions',
  'settings.privateTxSub': 'Route through a private relay',

  // -- deposit / qr --
  'deposit.title': 'Deposit',
  'deposit.subtitle': 'Fund your wallet',
  'deposit.address': 'Address',
  'deposit.mainnetOnlyBold': 'Ethereum mainnet only.',
  'deposit.mainnetOnlyBody': 'Send only the tokens above — anything else may be permanently lost.',
  'deposit.unavailableTitle': 'Address unavailable',
  'deposit.noAddress':
    'No wallet address was passed in. Use /deposit in the bot chat, or open this screen from a bot button.',
  'deposit.noWallet': 'No wallet yet — send /start to the bot to create one.',

  // -- policy / security --
  'policy.title': 'Wallet security',
  'policy.subtitle': 'Self-custody, enforced in hardware',
  'policy.intro':
    'Your wallet’s keys live in a trusted execution environment (TEE). FxAeon holds no custody and no policy lock — what the bot CAN do is decided by you, through a revocable permission.',
  'policy.rule1Title': 'Your keys, full stop',
  'policy.rule1Body':
    'You create or import the wallet yourself. The key sits in a hardware enclave, exportable by you any time — FxAeon never sees it.',
  'policy.rule2Title': 'Bot trading is a grant, not a default',
  'policy.rule2Body':
    'The bot can only sign while your session-signer grant is active. Revoke it in Settings → Wallet and chat execution stops instantly.',
  'policy.rule3Title': 'Simulation-gated execution',
  'policy.rule3Body':
    'Every chat-confirmed action is simulated first. If it would fail, nothing is broadcast — fail closed, always.',
  'policy.rule4Title': 'Explicit confirms only',
  'policy.rule4Body':
    'No transaction is built or sent before you tap Confirm. Previews expire after ~10 minutes.',
  'policy.footer':
    'Manage everything in Settings → Wallet: export your key, enable or revoke bot trading. Check /security in the bot for the live status.',
  // -- login sign-in card (PrivyFlow intro) --
  'loginCard.signIn': 'Sign in to FxAeon',
  'loginCard.subtitle': 'Self-custodial wallet powered by Privy',
  'loginCard.telegram': 'Continue with Telegram',
  'loginCard.email': 'Continue with Email',
  'loginCard.wallet': 'Connect existing wallet',
  'loginCard.terms': 'By continuing you accept our Terms and Privacy',
  'loginCard.poweredBy': 'Powered by',
};

export default en;
