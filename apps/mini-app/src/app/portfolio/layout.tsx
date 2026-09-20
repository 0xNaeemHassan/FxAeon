import type { Metadata } from 'next';

// Existing bookmarks remain usable; search engines should index the app home.
export const metadata: Metadata = {
  title: 'Portfolio',
  alternates: { canonical: 'https://fxaeon.com/' },
};

export default function PortfolioAliasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
