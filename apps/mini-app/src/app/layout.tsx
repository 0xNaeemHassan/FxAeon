import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import { TelegramProvider } from '@/components/TelegramProvider';
import WalletProviderBoundary from '@/components/WalletProviderBoundary';
import { LocaleProvider } from '@/lib/i18n';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
  title: {
    default: 'FxAeon — f(x) Protocol Gateway',
    template: '%s · FxAeon',
  },
  description: 'The self-custodial f(x) Protocol gateway for trading, borrowing, saving, bridging, and position management in Telegram.',
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
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <head>
        {/* Load Telegram's native viewport, BackButton, link, and haptic APIs
            before client components initialize. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
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
