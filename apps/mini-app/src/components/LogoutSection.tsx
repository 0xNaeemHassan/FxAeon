'use client';

/**
 * Logout button — wrapped in its own PrivyClientProvider so the useLogout()
 * hook has the React context it needs.
 *
 * The root layout intentionally omits PrivyClientProvider (PERF: the Privy
 * SDK is heavy). The Settings page therefore cannot call useLogout() at the
 * top level — it would run outside any Privy context and throw. This
 * component isolates the hook inside a provider, matching the same pattern
 * WalletSection already uses for wallet controls.
 *
 * Loaded via next/dynamic from the Settings page so the Privy SDK chunk
 * is lazy-loaded only when the Settings tab is actually visited.
 */
import { useCallback, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useLogout } from '@privy-io/react-auth';
import { haptic } from '@/lib/telegram';
import { privyConfigured } from '@/lib/privyConfig';
import PrivyClientProvider from '@/components/PrivyClientProvider';
import { Button, Card, SectionTitle } from '@/components/ui';
import { useLocale } from '@/lib/i18n';

function PrivyLogoutControls() {
  const { logout } = useLogout();
  const { t } = useLocale();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    setError('');
    try {
      await logout();
      haptic('success');
    } catch (e) {
      setError((e as Error).message || 'Logout failed.');
    } finally {
      setLoggingOut(false);
    }
  }, [logout]);

  return (
    <>
      <SectionTitle>{t('settings.session')}</SectionTitle>
      <Card className="border-[rgba(255,90,95,0.25)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(255,90,95,0.12)]">
            <LogOut className="h-[18px] w-[18px] text-danger" strokeWidth={2} />
          </span>
          <span className="flex-1">
            <p className="text-[14px] font-medium">{t('settings.logoutTitle')}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">{t('settings.logoutBody')}</p>
            <Button
              variant="danger"
              onClick={handleLogout}
              loading={loggingOut}
              className="mt-3"
            >
              <LogOut className="h-4 w-4" />
              {t('settings.logout')}
            </Button>
          </span>
        </div>
      </Card>
      {error && (
        <Card className="mt-2 border-[rgba(255,90,95,0.35)]">
          <p className="text-[13px] text-danger">{error}</p>
        </Card>
      )}
    </>
  );
}

export default function LogoutSection() {
  if (!privyConfigured()) {
    return null;
  }

  return (
    <PrivyClientProvider>
      <PrivyLogoutControls />
    </PrivyClientProvider>
  );
}
