import type { Metadata } from 'next';
import PortfolioPage from './portfolio/page';

export const metadata: Metadata = {
  title: { absolute: 'Portfolio · FxAeon' },
  description: 'Trade, borrow, earn, and bridge with the f(x) SDK from the web or Telegram.',
  alternates: { canonical: 'https://fxaeon.com/' },
  openGraph: {
    type: 'website',
    url: 'https://fxaeon.com/',
    siteName: 'FxAeon',
    title: 'FxAeon Portfolio',
    description: 'Trade, borrow, earn, and bridge with the f(x) SDK from the web or Telegram.',
  },
  twitter: {
    card: 'summary_large_image',
    creator: '@FxAeonxyz',
    title: 'FxAeon Portfolio',
    description: 'Trade, borrow, earn, and bridge with the f(x) SDK from the web or Telegram.',
  },
};

export default function HomePage() {
  return <PortfolioPage />;
}
