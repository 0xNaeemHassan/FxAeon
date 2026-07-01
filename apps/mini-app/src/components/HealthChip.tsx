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
import { apiAvailable } from '@/lib/api';

type DepStatus = 'ok' | 'degraded' | 'down';

interface DepsResponse {
  overall: DepStatus;
  deps: Record<string, DepStatus>;
}

const POLL_INTERVAL_MS = 60_000;

const statusEmoji: Record<DepStatus, string> = {
  ok: '🟢',
  degraded: '🟡',
  down: '🔴',
};

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
        const res = await fetch(`${botApi}/api/health/deps`, {
          signal: AbortSignal.timeout(5_000),
        });
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
      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
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
      <span>{statusEmoji[data.overall]}</span>
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
