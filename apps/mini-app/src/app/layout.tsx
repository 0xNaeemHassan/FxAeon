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
const themeInitializer = `(()=>{try{const v=localStorage.getItem('fxaeon_theme_id_v2');const t=v==='official'||v==='dark'||v==='light'?v:localStorage.getItem('fxaeon_theme_id')==='light'?'light':'official';const r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t==='light'?'light':'dark';}catch{}})();`;

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
  themeColor: '#100e18',
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
        {/* Telegram requires its host bridge in <head> before application
            scripts. It remains a progressive enhancement: a failed request
            never blocks FxAeon's browser-compatible routes or login. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
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
