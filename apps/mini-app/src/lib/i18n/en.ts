import type { Messages } from './config';

const en: Messages = {
  'nav.home': 'Home',
  'nav.trade': 'Trade',
  'nav.earn': 'Earn',
  'nav.move': 'Move',
  'nav.more': 'More',
  'common.openInTelegram': 'Open in Telegram',
  'common.save': 'Save changes',
  'common.saved': 'Saved',
  'common.loading': 'Loading live protocol state…',
  'splash.tagline':
    'Trade, borrow, save, bridge, and manage f(x) Protocol positions from one self-custodial Telegram app.',
  'loginGate.tgTitle': 'FxAeon runs inside Telegram',
  'loginGate.tgBody': 'Open the FxAeon Mini App from Telegram to continue.',
  'loginGate.notConfTitle': 'Wallet service not configured',
  'loginGate.notConfBody':
    'This build is missing NEXT_PUBLIC_PRIVY_APP_ID. Add the public Privy app ID and rebuild.',
  'loginCard.signIn': 'Sign in to FxAeon',
  'loginCard.telegram': 'Continue with Telegram',
  'loginCard.email': 'Continue with email',
  'loginCard.wallet': 'Connect an existing wallet',
  'loginCard.terms': 'Privy handles authentication and wallet custody. FxAeon never receives your private key.',
  'loginCard.poweredBy': 'Wallet security by',
  'settings.title': 'Settings',
  'settings.maxSlippage': 'Slippage tolerance',
  'settings.language': 'Language',
  'settings.session': 'Session',
  'settings.logoutTitle': 'Sign out',
  'settings.logoutBody': 'Disconnect this app session. Your wallet and keys remain in your custody.',
  'settings.logout': 'Sign out',
};

export default en;
