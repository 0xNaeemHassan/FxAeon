/**
 * Telegram Native Biometric Manager Integration
 *
 * Wraps Telegram's BiometricManager API to authenticate high-risk actions
 * (confirming large transactions, exporting private keys) via FaceID or TouchID.
 * Falls back gracefully when running in standard browser or unsupported clients.
 */
import { getWebApp } from '@/lib/telegram';

export interface BiometricStatus {
  available: boolean;
  type: 'face' | 'finger' | 'unknown';
  accessGranted: boolean;
  inited: boolean;
}

class BiometricService {
  private inited = false;
  private userEnabled = true;

  constructor() {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('fxaeon_biometrics_enabled');
      this.userEnabled = stored === null ? true : stored === 'true';
    }
  }

  public isUserEnabled(): boolean {
    return this.userEnabled;
  }

  public setUserEnabled(val: boolean) {
    this.userEnabled = val;
    if (typeof window !== 'undefined') {
      localStorage.setItem('fxaeon_biometrics_enabled', String(val));
    }
  }

  public async init(): Promise<BiometricStatus> {
    const webapp = getWebApp();
    const mgr = webapp?.BiometricManager;

    if (!mgr) {
      return { available: false, type: 'unknown', accessGranted: false, inited: false };
    }

    if (mgr.isInited) {
      this.inited = true;
      return {
        available: Boolean(mgr.isBiometricAvailable),
        type: (mgr.biometricType as 'face' | 'finger') || 'unknown',
        accessGranted: Boolean(mgr.isAccessGranted),
        inited: true,
      };
    }

    return new Promise((resolve) => {
      try {
        mgr.init(() => {
          this.inited = true;
          resolve({
            available: Boolean(mgr.isBiometricAvailable),
            type: (mgr.biometricType as 'face' | 'finger') || 'unknown',
            accessGranted: Boolean(mgr.isAccessGranted),
            inited: true,
          });
        });
      } catch {
        resolve({ available: false, type: 'unknown', accessGranted: false, inited: false });
      }
    });
  }

  public async authenticate(reason = 'Confirm transaction'): Promise<{ success: boolean; error?: string }> {
    if (!this.userEnabled) {
      return { success: true };
    }

    const webapp = getWebApp();
    const mgr = webapp?.BiometricManager;

    if (!mgr || !mgr.isBiometricAvailable) {
      // Biometrics unavailable on client: allow transparent progression
      return { success: true };
    }

    if (!mgr.isAccessGranted) {
      const granted = await new Promise<boolean>((resolve) => {
        mgr.requestAccess({ reason }, (ok: boolean) => resolve(ok));
      });
      if (!granted) {
        return { success: false, error: 'Biometric access permission was denied.' };
      }
    }

    return new Promise((resolve) => {
      mgr.authenticate({ reason }, (authenticated: boolean) => {
        if (authenticated) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: 'Biometric authentication was not completed.' });
        }
      });
    });
  }
}

export const biometrics = new BiometricService();
