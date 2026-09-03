'use client';

import { useState } from 'react';
import { Key, Plus, Copy, Trash2, Eye, EyeOff, Shield } from 'lucide-react';

interface ApiKey {
  id: number;
  name: string;
  key: string;
  created: string;
  lastUsed: string;
}

export default function ApiKeysPage() {
  const [showKeys, setShowKeys] = useState(false);
  const [keys] = useState<ApiKey[]>([
    { id: 1, name: 'Production Key', key: 'ak_prod_demo_placeholder_0001', created: '2026-01-15', lastUsed: '2 minutes ago' },
    { id: 2, name: 'Development Key', key: 'ak_dev_demo_placeholder_0002', created: '2026-02-20', lastUsed: '1 hour ago' },
  ]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">API Keys</h1>
          <p className="text-white/60">Manage your API keys for integrations.</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition">
          <Plus className="w-4 h-4" />
          Create New Key
        </button>
      </div>

      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-5 h-5 text-yellow-400 mt-0.5" />
        <div>
          <h3 className="text-yellow-400 font-semibold mb-1">Keep your keys secure</h3>
          <p className="text-yellow-400/80 text-sm">Never share your API keys publicly. Store them securely and rotate them regularly.</p>
        </div>
      </div>

      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Your API Keys</h2>
          <button onClick={() => setShowKeys(!showKeys)} className="flex items-center gap-2 text-white/60 hover:text-white transition">
            {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showKeys ? 'Hide' : 'Show'} Keys
          </button>
        </div>
        <div className="divide-y divide-white/5">
          {keys.map((apiKey) => (
            <div key={apiKey.id} className="p-4 hover:bg-white/5 transition">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Key className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <div className="text-white font-medium">{apiKey.name}</div>
                    <div className="text-white/50 text-sm">Created {apiKey.created}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => copyToClipboard(apiKey.key)} className="p-2 hover:bg-white/10 rounded-lg transition" title="Copy">
                    <Copy className="w-4 h-4 text-white/60" />
                  </button>
                  <button className="p-2 hover:bg-red-500/10 rounded-lg transition" title="Delete">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-black/30 rounded-lg p-3">
                <code className="text-green-400 font-mono text-sm flex-1 truncate">
                  {showKeys ? apiKey.key : '••••••••••••••••••••••••••••'}
                </code>
                <span className="text-white/40 text-xs">Last used: {apiKey.lastUsed}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="text-white/60 text-sm mb-2">Total Requests</div>
          <div className="text-2xl font-bold text-white">24,592</div>
          <div className="text-green-400 text-sm mt-1">+12.5% this month</div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="text-white/60 text-sm mb-2">Active Keys</div>
          <div className="text-2xl font-bold text-white">{keys.length}</div>
          <div className="text-white/40 text-sm mt-1">1 production, 1 development</div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="text-white/60 text-sm mb-2">Error Rate</div>
          <div className="text-2xl font-bold text-white">0.02%</div>
          <div className="text-green-400 text-sm mt-1">Excellent</div>
        </div>
      </div>
    </div>
  );
}
