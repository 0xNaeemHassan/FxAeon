'use client';

/**
 * Security explainer — how the default-deny policy protects the wallet.
 * Purely informational: the policy is enforced server-side inside Privy's TEE
 * from the moment the wallet is created. (The old screen had a Privy
 * "Sign Policy" button that did nothing real — removed.)
 */
import { ShieldCheck, Check, Lock } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';

const RULES = [
  {
    title: 'f(x) Router calls only',
    body: 'Transactions may only target the verified f(x) Protocol router contract.',
  },
  {
    title: 'fxSAVE harvest only',
    body: 'The single allowed automation call is harvesting fxSAVE yield.',
  },
  {
    title: 'f(x) limit-order signing only',
    body: 'EIP-712 signatures are restricted to the f(x) Limit Order Manager domain.',
  },
  {
    title: 'Everything else: DENIED',
    body: 'Any other contract, token approval or signature request is rejected by default.',
  },
];

export default function PolicyPage() {
  return (
    <AppShell title="Wallet security" subtitle="Default-deny, enforced in hardware">
      <div className="stagger flex flex-col gap-3.5">
        <Card className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
            <Lock className="h-5 w-5 text-mint" />
          </span>
          <p className="text-[13px] leading-relaxed text-mut">
            Your wallet&apos;s keys live in a trusted execution environment (TEE). Every
            transaction is checked against the policy below <em>before</em> signing — FxAeon
            itself can&apos;t bypass it.
          </p>
        </Card>

        {RULES.map((r) => (
          <Card key={r.title} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--mint-dim)]">
              <Check className="h-4 w-4 text-mint" strokeWidth={2.5} />
            </span>
            <span>
              <p className="text-[14px] font-medium">{r.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">{r.body}</p>
            </span>
          </Card>
        ))}

        <Card className="flex items-start gap-2.5 border-[rgba(46,230,168,0.25)]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
          <p className="text-[12.5px] leading-relaxed text-mut">
            The policy is attached automatically when your wallet is created and is enforced on
            every action. Check <span className="font-mono text-mint">/security</span> in the bot
            for your wallet&apos;s live policy status.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
