'use client';

/**
 * Logout control for the single app wallet session.
 *
 * This component must use the shared wallet adapter. A nested Privy context
 * can leave the settings screen signed into a different client session than
 * the protocol pages, and would bypass the browser fallback's disconnect
 * marker.
 */
import { useCallback, useState } from 'react';
import { LogOut } from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { Button, Card, SectionTitle } from '@/components/ui';
import { useLocale } from '@/lib/i18n';
import { userSafeError } from '@/lib/errors';
import { usePrivyWallet } from '@/lib/wallet';

function LogoutControls() {
  const { disconnect } = usePrivyWallet();
  const { t } = useLocale();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    setError('');
    try {
      await disconnect();
      haptic('success');
    } catch (e) {
      setError(userSafeError(e, 'Logout could not be completed. Try again.'));
      haptic('error');
    } finally {
      setLoggingOut(false);
    }
  }, [disconnect]);

  return (
    <>
      <SectionTitle>{t('settings.session')}</SectionTitle>
      <Card className="border-[rgba(255,90,95,0.25)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(255,90,95,0.12)]">
            <LogOut className="h-[18px] w-[18px] text-danger" strokeWidth={2} aria-hidden="true" />
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
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {t('settings.logout')}
            </Button>
          </span>
        </div>
      </Card>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {loggingOut ? 'Signing out…' : ''}
      </p>
      {error && (
        <Card className="mt-2 border-[rgba(255,90,95,0.35)]">
          <p role="alert" className="text-[13px] text-danger">{error}</p>
        </Card>
      )}
    </>
  );
}

export default function LogoutSection() {
  return <LogoutControls />;
}
