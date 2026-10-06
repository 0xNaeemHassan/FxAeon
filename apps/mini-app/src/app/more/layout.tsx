import type { Metadata } from 'next';
import { routeMetadata } from '@/app/routeMetadata';

export const metadata: Metadata = routeMetadata('more');

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
