'use client';

/**
 * HealthChip — Mini App degraded-service indicator.
 *
 * Polls the bot's /health/deps endpoint every 60s. Shows a subtle chip when
 * any dependency is degraded or down. Hidden when everything is ok.
 *
 * Phase 1 (Masterplan §1.7): "Mini App reads /health and surfaces a degraded
 * chip with a tooltip explaining what's slow."
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { apiAvailable } from '@/lib/api';

type DepStatus = 'ok' | 'degraded' | 'down';

interface DepsResponse {
  overall: DepStatus;
  deps: Record<string, DepStatus>;
}

const POLL_INTERVAL_MS = 60_000;

const statusLabel: Record<DepStatus, string> = {
  ok: 'All systems operational',
  degraded: 'Some services degraded',
  down: 'Service disruption',
};

function depName(key: string): string {
  switch (key) {
    case 'db':
      return 'Database';
    case 'redis':
      return 'Cache';
    case 'rpc':
      return 'Blockchain RPC';
    default:
      return key;
  }
}

export function HealthChip() {
  const [data, setData] = useState<DepsResponse | null>(null);

  useEffect(() => {
    if (!apiAvailable()) return;

    let mounted = true;
    const fetchHealth = async () => {
      try {
        const botApi = process.env.NEXT_PUBLIC_BOT_API_URL;
        if (!botApi) return;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(`${botApi}/api/health/deps`, {
          signal: controller.signal,
        });
        window.clearTimeout(timeout);
        if (res.ok && mounted) {
          setData(await res.json());
        }
      } catch {
        // Fail silent — the chip just hides.
      }
    };

    fetchHealth();
    const id = setInterval(fetchHealth, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  // Don't render when healthy or unknown.
  if (!data || data.overall === 'ok') return null;

  const badDeps = Object.entries(data.deps).filter(([, s]) => s !== 'ok');

  return (
    <div
      role="status"
      aria-live="polite"
      className="glass mb-3 flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-xs"
      style={{
        borderColor:
          data.overall === 'down'
            ? 'var(--red-dim, #4a1a1a)'
            : 'var(--yellow-dim, #4a3a1a)',
        backgroundColor:
          data.overall === 'down'
            ? 'rgba(220, 38, 38, 0.08)'
            : 'rgba(234, 179, 8, 0.08)',
      }}
    >
      {data.overall === 'down' ? (
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      )}
      <div className="flex flex-col">
        <span className="font-medium">{statusLabel[data.overall]}</span>
        <span className="text-mut">
          {badDeps
            .map(([key, status]) => `${depName(key)}: ${status}`)
            .join(' · ')}
        </span>
      </div>
    </div>
  );
}
