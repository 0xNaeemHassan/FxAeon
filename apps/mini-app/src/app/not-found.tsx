import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';
import { FxLogo } from '@/components/FxLogo';

export default function NotFound() {
  return (
    <main className="app-shell mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center px-6 py-10 text-center">
      <div className="brand-orbit"><FxLogo size={52} /></div>
      <span className="mt-7 flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--mint-dim)] text-mint">
        <Compass className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-mint">404 · route not found</p>
      <h1 className="text-display mt-2 text-[28px] font-semibold tracking-[-0.04em]">This screen is outside FxAeon</h1>
      <p className="mt-2 max-w-[310px] text-[12.5px] leading-relaxed text-mut">FxAeon exposes only the official f(x) SDK flows. Return to the portfolio to continue safely.</p>
      <Link href="/portfolio" className="button button-primary glass-press mt-6 flex min-h-12 w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-semibold">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to portfolio
      </Link>
    </main>
  );
}
