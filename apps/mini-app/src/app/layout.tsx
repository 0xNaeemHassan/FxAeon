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
        {/* Apply the theme BEFORE first paint so ThemeProvider doesn't need
            to hide the app until hydration (the old `visibility:hidden`
            anti-flash wrapper meant nothing painted until React loaded —
            blank screen on slow cold starts, NO_FCP in Lighthouse).
            Resolution order mirrors ThemeProvider: localStorage override →
            Telegram colorScheme → prefers-color-scheme. Fail-soft: defaults
            to light, ThemeProvider corrects after mount. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('fxaeon-theme');var d;if(t==='dark'){d=true}else if(t==='light'){d=false}else{var tg=window.Telegram&&window.Telegram.WebApp;d=tg&&tg.colorScheme?tg.colorScheme==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches}var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light'}catch(e){}})();`,
          }}
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
