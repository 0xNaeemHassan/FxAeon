'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function HomePage() {
  const { ready, authenticated } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready) {
      if (authenticated) {
        router.replace('/portfolio');
      } else {
        router.replace('/login');
      }
    }
  }, [ready, authenticated, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
