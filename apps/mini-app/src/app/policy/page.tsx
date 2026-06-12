'use client';

/**
 * Security explainer — self-custody and the session-signer model.
 * Purely informational. (Replaced the old default-deny policy explainer:
 * FxAeon no longer policy-locks wallets — the wallet is the user's.)
 */
import { ShieldCheck, Check, Lock } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';

const RULES = [
  {
    title: 'Your keys, full stop',
    body: 'You create or import the wallet yourself. The key sits in a hardware enclave, exportable by you any time — FxAeon never sees it.',
  },
  {
    title: 'Bot trading is a grant, not a default',
    body: 'The bot can only sign while your session-signer grant is active. Revoke it in Settings → Wallet and chat execution stops instantly.',
  },
  {
    title: 'Simulation-gated execution',
    body: 'Every chat-confirmed action is simulated first. If it would fail, nothing is broadcast — fail closed, always.',
  },
  {
    title: 'Explicit confirms only',
    body: 'No transaction is built or sent before you tap Confirm. Previews expire after ~10 minutes.',
  },
];

export default function PolicyPage() {
  return (
    <AppShell title="Wallet security" subtitle="Self-custody, enforced in hardware">
      <div className="stagger flex flex-col gap-3.5">
        <Card className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
            <Lock className="h-5 w-5 text-mint" />
          </span>
          <p className="text-[13px] leading-relaxed text-mut">
            Your wallet&apos;s keys live in a trusted execution environment (TEE). FxAeon
            holds no custody and no policy lock — what the bot CAN do is decided by you,
            through a revocable permission.
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
            Manage everything in Settings → Wallet: export your key, enable or revoke bot
            trading. Check <span className="font-mono text-mint">/security</span> in the bot
            for the live status.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
