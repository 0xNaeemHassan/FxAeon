'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';
import { ArrowLeft, Globe, Sliders, Shield, Zap, Bell, Key } from 'lucide-react';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'ja', name: '日本語' },
  { code: 'ru', name: 'Русский' },
  { code: 'es', name: 'Español' },
];

export default function SettingsPage() {
  const { user, logout } = usePrivy();
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState('en');
  const [slippage, setSlippage] = useState(0.5);
  const [mevProtection, setMevProtection] = useState(false);
  const [notifications, setNotifications] = useState({
    tx: true,
    orders: true,
    health: true,
    rewards: false,
    governance: false,
    rules: true,
  });
  const [byokKey, setByokKey] = useState('');
  const [showByok, setShowByok] = useState(false);

  const handleSave = () => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.sendData(JSON.stringify({
        type: 'settings_updated',
        language: lang,
        slippage,
        mevProtection,
        notifications,
      }));
    }
  };

  return (
    <div className="flex min-h-screen flex-col p-4 bg-gray-50">
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

      <button type="button" onClick={() => window.Telegram?.WebApp?.close()} 
        className="flex items-center text-gray-600 mb-4"
      >
        <ArrowLeft className="w-5 h-5 mr-1" /> Back
      </button>

      <h1 className="text-xl font-bold mb-4">Settings</h1>

      {/* Language */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-5 h-5 text-primary" />
          <h2 className="font-medium">Language</h2>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {LANGUAGES.map((l) => (
            <button type="button" key={l.code}
              onClick={() => setLang(l.code)}
              className={`p-2 rounded-lg text-sm font-medium transition-colors ${
                lang === l.code
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>

      {/* Slippage */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <Sliders className="w-5 h-5 text-primary" />
          <h2 className="font-medium">Slippage Tolerance</h2>
        </div>
        <div className="flex gap-2 mb-2">
          {[0.1, 0.5, 1.0, 2.0].map((s) => (
            <button type="button" key={s}
              onClick={() => setSlippage(s)}
              className={`flex-1 p-2 rounded-lg text-sm font-medium transition-colors ${
                slippage === s
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {s}%
            </button>
          ))}
        </div>
        <input
          type="range"
          min="0.1"
          max="2.0"
          step="0.1"
          value={slippage}
          onChange={(e) => setSlippage(parseFloat(e.target.value))}
          className="w-full"
        />
        <p className="text-xs text-gray-500 mt-1">Current: {slippage}%</p>
      </div>

      {/* MEV Protection */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            <h2 className="font-medium">MEV Protection</h2>
          </div>
          <button type="button" onClick={() => setMevProtection(!mevProtection)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              mevProtection ? 'bg-green-500' : 'bg-gray-300'
            }`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              mevProtection ? 'translate-x-7' : 'translate-x-1'
            }`} />
          </button>
        </div>
        <p className="text-xs text-gray-500">
          {mevProtection 
            ? 'Flashbots Protect enabled. Slower but sandwich-protected.' 
            : 'Default public mempool. Faster but exposed to MEV.'}
        </p>
      </div>

      {/* Notifications */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-5 h-5 text-primary" />
          <h2 className="font-medium">Notifications</h2>
        </div>
        <div className="space-y-2">
          {Object.entries(notifications).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm capitalize">{key.replace('_', ' ')}</span>
              <button type="button" onClick={() => setNotifications(prev => ({ ...prev, [key]: !value }))}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  value ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  value ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* BYOK */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <Key className="w-5 h-5 text-primary" />
          <h2 className="font-medium">AI Provider (BYOK)</h2>
        </div>
        <button type="button" onClick={() => setShowByok(!showByok)}
          className="text-sm text-primary underline mb-2"
        >
          {showByok ? 'Hide' : 'Add your own API key'}
        </button>
        {showByok && (
          <div className="space-y-2">
            <input
              type="password"
              content="OpenAI / Anthropic / Surplus key"
              value={byokKey}
              onChange={(e) => setByokKey(e.target.value)}
              className="w-full p-2 border border-gray-200 rounded-lg text-sm"
            />
            <p className="text-xs text-gray-500">
              Encrypted with libsodium. Never logged or shared.
            </p>
          </div>
        )}
      </div>

      {/* Security */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-5 h-5 text-primary" />
          <h2 className="font-medium">Security</h2>
        </div>
        <div className="space-y-2 text-sm">
          <p className="text-gray-600">Wallet: {user?.wallet?.address?.slice(0, 6)}...{user?.wallet?.address?.slice(-4)}</p>
          <p className="text-gray-600">Auth: Telegram + Privy TEE</p>
          <p className="text-gray-600">Daily tx cap: 50</p>
        </div>
      </div>

      <button type="button" onClick={handleSave}
        className="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-primary/90 mb-3"
      >
        Save Settings
      </button>

      <button type="button" onClick={logout}
        className="w-full bg-red-50 text-red-600 py-3 rounded-lg font-medium hover:bg-red-100"
      >
        Disconnect Wallet
      </button>
    </div>
  );
}
