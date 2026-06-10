import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { PrivyProvider } from '@/components/PrivyProvider';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/components/ThemeProvider';
import { LoadingProvider } from '@/components/LoadingProvider';

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
      <body className={inter.className}>
        <ThemeProvider>
          <PrivyProvider>
            <LoadingProvider>
              <ErrorBoundary>{children}</ErrorBoundary>
            </LoadingProvider>
          </PrivyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
