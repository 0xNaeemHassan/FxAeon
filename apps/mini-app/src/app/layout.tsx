import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import './globals.css';
import { PrivyProvider } from '@/components/PrivyProvider';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/components/ThemeProvider';
import { LoadingProvider } from '@/components/LoadingProvider';
import { TelegramProvider } from '@/components/TelegramProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'fxBot — f(x) Protocol Trading',
  description: 'Non-custodial DeFi trading for f(x) Protocol',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Telegram injects NOTHING — window.Telegram.WebApp only exists if
            this script is loaded. Without it, sendData/BackButton/theme are
            all silently undefined (W-20). beforeInteractive so it is present
            before any page code runs. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={inter.className}>
        <TelegramProvider>
          <ThemeProvider>
            <PrivyProvider>
              <LoadingProvider>
                <ErrorBoundary>{children}</ErrorBoundary>
              </LoadingProvider>
            </PrivyProvider>
          </ThemeProvider>
        </TelegramProvider>
      </body>
    </html>
  );
}
