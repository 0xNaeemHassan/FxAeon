'use client';

import { BookOpen, History, MessageCircleQuestionMark, QrCode, Settings, Sparkles } from 'lucide-react';
import { AppShell } from '@/components/ui';
import { ActionRow, PageHeading, RowGroup } from '@/components/ProductUI';
import { AccountSummary } from '@/components/AccountControls';
import { useAppearance } from '@/components/AppearancePreference';
import { THEMES } from '@/lib/theme';
import { usePrivyWallet } from '@/lib/wallet';
import styles from '@/components/SettingsWorkspace.module.css';
import { AccountWorkspace } from '@/components/ProductLayout';

/** Secondary destinations, not a duplicate portfolio or wallet manager. */
export default function MorePage() {
  const { theme, ready } = useAppearance();
  const wallet = usePrivyWallet();
  return <AppShell>
    <AccountWorkspace className={styles.workspace + ' ' + styles.moreWorkspace}>
      <PageHeading title="More" />
      <div className={styles.identity}><AccountSummary /></div>
      <RowGroup title="Account">
        <ActionRow icon={History} title="History" description="Activity on this device" href="/history" />
        <ActionRow icon={QrCode} title="Receive" description={wallet.ready && !wallet.address ? 'Connect a wallet to receive' : undefined} href="/qr" />
        <ActionRow icon={Settings} title="Settings" href="/settings" />
      </RowGroup>
      <RowGroup title="Preferences"><ActionRow icon={Sparkles} title="Appearance" value={ready ? THEMES[theme].name : '—'} href="/settings#appearance" /></RowGroup>
      <RowGroup title="Resources">
        <ActionRow icon={BookOpen} title="FxAeon docs" href="/docs" />
        <ActionRow icon={BookOpen} title="f(x) Protocol docs" href="https://fxprotocol.gitbook.io/fx-docs" external />
        <ActionRow icon={MessageCircleQuestionMark} title="Support on X" href="https://x.com/FxAeonxyz" external />
      </RowGroup>
    </AccountWorkspace>
  </AppShell>;
}
