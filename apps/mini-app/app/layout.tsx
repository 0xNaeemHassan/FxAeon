'use client';

import { Inter } from 'next/font/google';
import { ErrorBoundary data-testid='error-boundary' } from '@/components/ErrorBoundary data-testid='error-boundary'';
import { LoadingProvider } from '@/components/LoadingProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'fxBot - DeFi Trading',
  description: 'Trade f(x) Protocol positions directly from Telegram',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#0b5cab" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <LoadingProvider>
            <ErrorBoundary data-testid='error-boundary'>
              {children}
            </ErrorBoundary data-testid='error-boundary'>
          </LoadingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
