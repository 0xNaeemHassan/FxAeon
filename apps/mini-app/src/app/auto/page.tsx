'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';
import { ArrowLeft, Plus, Pause, Play, Trash2, Clock, TrendingUp, Shield } from 'lucide-react';

interface Rule {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'paused';
  trigger: string;
  lastRun?: string;
}

export default function AutoPage() {
  const { ready } = usePrivy();
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>([
    {
      id: '1',
      name: 'Auto-compound fxSAVE',
      type: 'auto-compound',
      status: 'active',
      trigger: 'Every Monday 12:00',
      lastRun: '2026-06-01',
    },
    {
      id: '2',
      name: 'TP wstETH Long @ $3500',
      type: 'take-profit',
      status: 'active',
      trigger: 'Price ≥ $3500',
    },
  ]);
  const [showCreate, setShowCreate] = useState(false);

  const toggleRule = (id: string) => {
    setRules(rules.map(r => 
      r.id === id ? { ...r, status: r.status === 'active' ? 'paused' : 'active' } : r
    ));
  };

  const deleteRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm">{error}</p>
            <button type="button"
              onClick={() => setError(null)}
              className="mt-2 text-red-600 text-sm hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col p-4 bg-gray-50">
      <button type="button" onClick={() => window.Telegram?.WebApp?.close()} 
        className="flex items-center text-gray-600 mb-4"
      >
        <ArrowLeft className="w-5 h-5 mr-1" /> Back
      </button>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Automation</h1>
        <button type="button" onClick={() => setShowCreate(!showCreate)}
          className="bg-primary text-white p-2 rounded-lg"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Policy notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
        <div className="flex items-start gap-2">
          <Shield className="w-5 h-5 text-blue-500 mt-0.5" />
          <div className="text-sm text-blue-700">
            <p className="font-medium">Trustless Automation</p>
            <p className="text-xs mt-1">
              Rules execute via Privy Policy Engine in a TEE. 
              You can revoke this at any time in /security.
            </p>
          </div>
        </div>
      </div>

      {/* Create rule form */}
      {showCreate && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
          <h2 className="font-medium mb-3">Create Rule</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-gray-600 block mb-1">Rule Type</label>
              <select className="w-full p-2 border border-gray-200 rounded-lg text-sm">
                <option>Auto-compound fxSAVE</option>
                <option>Take Profit</option>
                <option>Stop Loss</option>
                <option>DCA into fxSAVE</option>
                <option>Auto-rebalance</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">Trigger</label>
              <select className="w-full p-2 border border-gray-200 rounded-lg text-sm">
                <option>Price condition</option>
                <option>Cron schedule</option>
                <option>Health threshold</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">Value</label>
              <input 
                type="text" 
                content="e.g., $3500 or 0 12 * * 1"
                className="w-full p-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <button type="button" onClick={() => {
                setShowCreate(false);
                // Would create rule via API
              }}
              className="w-full bg-primary text-white py-2 rounded-lg text-sm font-medium"
            >
              Create Rule
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="space-y-3">
        {rules.map((rule) => (
          <div key={rule.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${rule.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="font-medium">{rule.name}</span>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => toggleRule(rule.id)}
                  className="p-1.5 rounded-lg hover:bg-gray-100"
                >
                  {rule.status === 'active' ? (
                    <Pause className="w-4 h-4 text-yellow-600" />
                  ) : (
                    <Play className="w-4 h-4 text-green-600" />
                  )}
                </button>
                <button type="button" onClick={() => deleteRule(rule.id)}
                  className="p-1.5 rounded-lg hover:bg-gray-100"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
            <div className="text-sm text-gray-500 space-y-1">
              <div className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                <span>Type: {rule.type}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>Trigger: {rule.trigger}</span>
              </div>
              {rule.lastRun && (
                <p className="text-xs">Last run: {rule.lastRun}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {rules.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>No automation rules yet</p>
          <p className="text-sm mt-1">Tap + to create your first rule</p>
        </div>
      )}
    </div>
  );
}
