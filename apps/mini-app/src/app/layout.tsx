import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import { TelegramProvider } from '@/components/TelegramProvider';
import WalletProviderBoundary from '@/components/WalletProviderBoundary';
import PriceProvider from '@/components/PriceProvider';
import { LocaleProvider } from '@/lib/i18n';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const themeInitializer = `(()=>{try{const t=localStorage.getItem('fxaeon_theme_id')==='light'?'light':'dark';const r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;}catch{}})();`;

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
  themeColor: '#080b10',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
        {/* Hydrate the public web app before loading Telegram's optional host
            bridge. Telegram launch routes already wait a bounded time for the
            bridge, while ordinary browsers must never be held on the splash
            screen by a slow or blocked telegram.org request. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
      </head>
      <body className={inter.className}>
        <LocaleProvider>
          <PriceProvider>
            <WalletProviderBoundary>
              <TelegramProvider>
                <ErrorBoundary>{children}</ErrorBoundary>
              </TelegramProvider>
            </WalletProviderBoundary>
          </PriceProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
