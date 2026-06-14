import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import { TelegramProvider } from '@/components/TelegramProvider';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
  title: 'FxAeon — f(x) Protocol Trading',
  description: 'Self-custodial DeFi trading for f(x) Protocol',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a12',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <head>
        {/* Telegram injects NOTHING — window.Telegram.WebApp only exists if
            this script is loaded. Without it, sendData/BackButton/haptics are
            all silently undefined (W-20). beforeInteractive so it is present
            before any page code runs. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={inter.className}>
        {/* PERF (W-20): no PrivyClientProvider here — the Privy SDK is heavy
            and only /login + Settings → Wallet need it. Those surfaces mount
            their own provider via next/dynamic. */}
        <TelegramProvider>
          <ErrorBoundary>{children}</ErrorBoundary>
        </TelegramProvider>
      </body>
    </html>
  );
}
