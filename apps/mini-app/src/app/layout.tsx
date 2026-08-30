import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import { TelegramProvider } from '@/components/TelegramProvider';
import WalletProviderBoundary from '@/components/WalletProviderBoundary';
import { LocaleProvider } from '@/lib/i18n';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: {
    default: 'FxAeon',
    template: '%s · FxAeon',
  },
  description: 'Trade, borrow, earn, and bridge with f(x) Protocol from the web or Telegram.',
  applicationName: 'FxAeon',
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'FxAeon' },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#07070d',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Start Telegram's bridge immediately, but do not let a slow or
            unreachable telegram.org block FxAeon's React hydration. Client
            launch gates wait a bounded time for the bridge when Telegram
            launch parameters prove that this document came from Telegram. */}
        <script
          src="https://telegram.org/js/telegram-web-app.js"
          async
        />
      </head>
      <body className={inter.className}>
        <LocaleProvider>
          <WalletProviderBoundary>
            <TelegramProvider>
              <ErrorBoundary>{children}</ErrorBoundary>
            </TelegramProvider>
          </WalletProviderBoundary>
        </LocaleProvider>
      </body>
    </html>
  );
}
