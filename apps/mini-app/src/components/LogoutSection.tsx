'use client';

/**
 * Logout control for the single global Privy session.
 *
 * This component must not create a nested provider. A nested Privy context can
 * leave the settings screen signed into a different client session than the
 * protocol pages.
 */
import { useCallback, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useLogout } from '@privy-io/react-auth';
import { haptic } from '@/lib/telegram';
import { privyConfigured } from '@/lib/privyConfig';
import { Button, Card, SectionTitle } from '@/components/ui';
import { useLocale } from '@/lib/i18n';
import { userSafeError } from '@/lib/errors';

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
      setError(userSafeError(e, 'Logout is temporarily unavailable. Try again.'));
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
          <p role="alert" className="text-[13px] text-danger">{error}</p>
        </Card>
      )}
    </>
  );
}

export default function LogoutSection() {
  if (!privyConfigured()) {
    return null;
  }
  return <PrivyLogoutControls />;
}
