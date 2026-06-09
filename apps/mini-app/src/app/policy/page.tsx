function safeJSONStringify(obj: any): string { try { return JSON.stringify(obj); } catch { return '{}'; } }
'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';
import { Shield, Check, AlertTriangle } from 'lucide-react';

const POLICY = {
  name: "fxBot-automation-policy",
  chain_type: "ethereum",
  rules: [
    {
      name: "allow-fx-router-calls",
      method: "eth_sendTransaction",
      action: "ALLOW",
      conditions: [
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: "0x33636D49FbefBE798e15e7F356E8DBef543CC708" },
        { field_source: "ethereum_transaction", field: "value", operator: "lte", value: "0" }
      ]
    },
    {
      name: "allow-fxsave-harvest",
      method: "eth_sendTransaction",
      action: "ALLOW",
      conditions: [
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: "0x7743e50F534a7f9F1791DdE7dCD89F7783Eefc39" },
        { field_source: "ethereum_calldata", field: "function_selector", operator: "eq", value: "0x4641257d" }
      ]
    },
    {
      name: "allow-limit-order-eip712-sign",
      method: "eth_signTypedData_v4",
      action: "ALLOW",
      conditions: [
        { field_source: "typed_data", field: "domain.name", operator: "eq", value: "f(x) Limit Order Manager" },
        { field_source: "typed_data", field: "domain.verifyingContract", operator: "eq", value: "0x112873b395B98287F3A4db266a58e2D01779Ad96" }
      ]
    },
    { name: "deny-all-else", action: "DENY" }
  ]
};

export default function PolicyPage() {
  const { user, signMessage } = usePrivy();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  const handleSign = async () => {
    const message = `I authorize fxBot to execute the following policy:

${safeJSONStringify(POLICY, null, 2)}

This authorization is revocable at any time via /security.`;
    await signMessage(message);
    setSigned(true);
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.sendData(safeJSONStringify({ type: 'policy_signed' }));
      window.Telegram.WebApp.close();
    }
  };

  return (
    <div className="flex min-h-screen flex-col p-4">
        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm">{error}</p>
            <button type="button" type="button"
              onClick={() => setError(null)}
              className="mt-2 text-red-600 text-sm hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold">Automation Policy</h1>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium">Trustless Automation</p>
            <p>This policy runs inside Privy&apos;s TEE. You can revoke it anytime.</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 mb-4 overflow-auto max-h-64">
        <pre className="text-xs text-gray-700">{safeJSONStringify(POLICY, null, 2)}</pre>
      </div>

      <div className="space-y-2 mb-6">
        <div className="flex items-center gap-2 text-sm">
          <Check className="w-4 h-4 text-green-500" />
          <span>Only f(x) Router calls allowed</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Check className="w-4 h-4 text-green-500" />
          <span>Only fxSAVE harvest allowed</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Check className="w-4 h-4 text-green-500" />
          <span>Only f(x) Limit Order EIP-712 signing</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Check className="w-4 h-4 text-green-500" />
          <span>Everything else DENIED by default</span>
        </div>
      </div>

      <button type="button" onClick={handleSign}
        disabled={signed}
        className="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {signed ? 'Signed ✓' : 'Sign Policy'}
      </button>
    </div>
  );
}
