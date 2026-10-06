import type { Metadata } from 'next';
import { routeMetadata } from '@/app/routeMetadata';

// Existing bookmarks remain usable; search engines should index the app home.
export const metadata: Metadata = {
  ...routeMetadata('portfolio'),
  alternates: { canonical: 'https://fxaeon.com/' },
};

export default function PortfolioAliasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
