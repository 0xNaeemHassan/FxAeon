'use client';

/**
 * Security explainer — self-custody and the session-signer model.
 * Purely informational. (Replaced the old default-deny policy explainer:
 * FxAeon no longer policy-locks wallets — the wallet is the user's.)
 */
import { ShieldCheck, Check, Lock } from 'lucide-react';
import { AppShell, Card } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function PolicyPage() {
  const t = useT();
  const RULES = [
    { title: t('policy.rule1Title'), body: t('policy.rule1Body') },
    { title: t('policy.rule2Title'), body: t('policy.rule2Body') },
    { title: t('policy.rule3Title'), body: t('policy.rule3Body') },
    { title: t('policy.rule4Title'), body: t('policy.rule4Body') },
  ];
  return (
    <AppShell title={t('policy.title')} subtitle={t('policy.subtitle')}>
      <div className="stagger flex flex-col gap-3.5">
        <Card className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mint-dim)]">
            <Lock className="h-5 w-5 text-mint" />
          </span>
          <p className="text-[13px] leading-relaxed text-mut">{t('policy.intro')}</p>
        </Card>

        {RULES.map((r) => (
          <Card key={r.title} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--success-dim)]">
              <Check className="h-4 w-4 text-success" strokeWidth={2.5} />
            </span>
            <span>
              <p className="text-[14px] font-medium">{r.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">{r.body}</p>
            </span>
          </Card>
        ))}

        <Card className="flex items-start gap-2.5 border-[rgba(124, 92, 255,0.25)]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
          <p className="text-[12.5px] leading-relaxed text-mut">{t('policy.footer')}</p>
        </Card>
      </div>
    </AppShell>
  );
}
