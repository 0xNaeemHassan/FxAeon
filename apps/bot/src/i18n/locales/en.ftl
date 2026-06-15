# English (source of truth)
# Keys mirror the CURRENT bot copy — extracted from command code in W-21,
# not the pre-W-16 drafts that used to sit in stale JSON catalogs.
# CI enforces key + variable parity across all locales (tests/i18n.test.ts).

## /start

start-welcome-new =
    🚀 Welcome to fxBot
    
    The most advanced interface for f(x) Protocol — leveraged positions, limit orders, and yield automation, all from Telegram.
    
    🔐 Self-custody — create or import YOUR wallet; only you hold the keys
    ⚡ Simulation-gated — nothing broadcasts unless it simulates clean
    🤖 Honest by design — no fake numbers, ever
start-referral-detected = 🎁 Referral code detected: { $code }
start-tap-button = 👇 Tap the button below to create or import your wallet.
start-create-wallet = 🔐 Set Up Wallet
start-welcome-back =
    👋 Welcome back to fxBot!
    
    Wallet: { $wallet }
start-positions =
    📊 You have { $count ->
        [one] 1 active position
       *[other] { $count } active positions
    }.
start-quick-actions = Quick actions: /trade /portfolio /settings
start-no-positions =
    No active positions yet.
    
    Get started: /trade /portfolio /help
start-error =
    ❌ Oops, something went wrong
    
    Please try again in a moment. If the issue persists, contact support.

## /help

help-body =
    📚 fxBot Help — Command Guide
    
    Tap any command below to use it, or type it directly.
    
    ⚡ Trading
      /trade — Open leveraged position (1.1x–7x)
      /limit — Place limit/stop orders
      /orders — View active orders
      /mint — Borrow fxUSD (no leverage)
      /redeem — Redeem fxSAVE back to fxUSD
      /repay — Repay fxUSD debt
    
    💰 Yield & Governance
      /save — fxSAVE deposit/withdraw
      /lock — Lock FXN → veFXN
      /vote — Gauge voting
      /claim — Claim matured fxSAVE redemption
    
    📊 Portfolio
      /portfolio — View positions, balances, health
      /history — Your on-chain action history
      /gas — Live gas prices
      /speedup — Speed up a stuck (pending) transaction
      /cancel — Cancel a stuck (pending) transaction
      /price — Live market overview (prices, mcap, 24h/7d)
      /alert — One-shot price alert (e.g. /alert btc > 65000)
      /alerts — Manage your price alerts
      /deposit — Show wallet address + QR
      /withdraw — Why external sends are off (security)
      /bridge — Bridge fxUSD (ETH ↔ Base)
    
    🤖 Automation
      /auto — Stop-loss / take-profit rules (/auto sl wstETH long 2500)
      /refer — Your referral link + earnings
    
    ⚙️ Settings
      /settings — Language, slippage, MEV protection
      /security — Policies, audits, export data
      /help — This menu
    
    Key Features:
    • Non-custodial — keys in Privy TEE
    • Zero on-ramps — fund your own wallet
    • MEV protection toggle (Flashbots, free)
    • 8 languages: en, zh-CN, ko, ja, ru, es, tr, pt
    
    Need help? Use /start to reconnect or contact support.
help-error = ❌ Couldn't load the help menu. Try /start to reconnect.

## /settings

settings-overview =
    ⚙️ Settings
    
    Language: { $lang }
    Slippage: { $slippage }%
    MEV Protection: { $mev }
    
    To change:
    /settings lang en
    /settings slippage 1.0
    /settings mev on|off
settings-mev-on = ✅ Flashbots
settings-mev-off = ❌ Off
settings-lang-set = Language set to { $value }
settings-slippage-set = Slippage set to { $value }%
settings-slippage-invalid = Slippage must be between 0.01% and { $max }%
settings-mev-enabled = MEV Protection enabled (Flashbots)
settings-mev-disabled = MEV Protection disabled
settings-unknown = Unknown setting. Use /settings to see options.

## /trade

trade-usage =
    ⚡ Open a Leveraged Position
    
    Pick a market below, or type the full command.
    
    Usage:
    /trade <market> <long|short> <leverage> <amount>
    
    Example:
    /trade wstETH long 3x 1ETH
    
    Leverage Limits:
    • Long: { $minLev }x – { $maxLong }x
    • Short: { $minLev }x – { $maxShort }x

## /portfolio

portfolio-empty =
    { $partial ->
        [yes] No active positions in the markets we could read.
       *[no] No active positions.
    }
    
    💡 Get started:
    • /trade — Open a leveraged position
    • /mint — Borrow fxUSD (no leverage)
    • /save — Deposit into fxSAVE for yield

## Shared errors

errors-generic = ❌ An error occurred. Please try again.
