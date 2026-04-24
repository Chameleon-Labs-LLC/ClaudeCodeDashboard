'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TelemetryStatus } from '@/types/otel';

interface ClaudeSettings {
  settings: Record<string, unknown>;
  mcp: Record<string, unknown>;
  plugins: Array<{
    name: string;
    scope: string;
    installPath: string;
    installedAt: string;
    lastUpdated: string;
  }>;
}

type Tab = 'settings' | 'mcp' | 'plugins' | 'telemetry';

const OTEL_KEY_LABELS: Record<string, string> = {
  CLAUDE_CODE_ENABLE_TELEMETRY:  'Enable telemetry',
  OTEL_EXPORTER_OTLP_ENDPOINT:   'OTLP endpoint',
  OTEL_EXPORTER_OTLP_PROTOCOL:   'OTLP protocol',
  OTEL_METRICS_EXPORTER:         'Metrics exporter',
  OTEL_LOGS_EXPORTER:            'Logs exporter',
  OTEL_LOG_TOOL_DETAILS:         'Log tool details',
};

const OTEL_DESIRED: Record<string, string> = {
  CLAUDE_CODE_ENABLE_TELEMETRY:  '1',
  OTEL_EXPORTER_OTLP_ENDPOINT:   'http://localhost:3000',
  OTEL_EXPORTER_OTLP_PROTOCOL:   'http/json',
  OTEL_METRICS_EXPORTER:         'otlp',
  OTEL_LOGS_EXPORTER:            'otlp',
  OTEL_LOG_TOOL_DETAILS:         '1',
};

export default function SettingsPage() {
  const [data, setData] = useState<ClaudeSettings | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('settings');
  const [wizardRunning, setWizardRunning] = useState(false);
  const [wizardResult, setWizardResult] = useState<string | null>(null);

  const loadAll = useCallback(() => {
    Promise.all([
      fetch('/api/settings').then(r => r.json() as Promise<ClaudeSettings>),
      fetch('/api/telemetry/status').then(r => r.json() as Promise<TelemetryStatus>),
    ])
      .then(([settings, tel]) => {
        setData(settings);
        setTelemetry(tel);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const runWizard = useCallback(async () => {
    setWizardRunning(true);
    setWizardResult(null);
    try {
      const res = await fetch('/api/telemetry/setup', { method: 'POST' });
      const json = await res.json() as { message: string };
      setWizardResult(json.message ?? 'Done');
      // Refresh status after wizard
      const tel = await fetch('/api/telemetry/status').then(r => r.json() as Promise<TelemetryStatus>);
      setTelemetry(tel);
    } catch {
      setWizardResult('Error contacting setup endpoint. Run `npm run setup:otel` from the terminal instead.');
    } finally {
      setWizardRunning(false);
    }
  }, []);

  if (loading) return <p className="text-gray-400 animate-pulse">Loading...</p>;
  if (!data) return <p className="text-gray-500 text-sm">Failed to load settings.</p>;

  const tabs: Tab[] = ['settings', 'mcp', 'plugins', 'telemetry'];

  // Compute overall telemetry health
  const allPresent = telemetry
    ? Object.values(telemetry.keys).every(k => k.present)
    : false;
  const missingCount = telemetry
    ? Object.values(telemetry.keys).filter(k => !k.present).length
    : 6;

  return (
    <div>
      <h2 className="font-heading text-2xl text-brand-cyan mb-6">Settings Inspector</h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 flex-wrap">
        {tabs.map(tab => {
          const showBadge = tab === 'telemetry' && !allPresent && missingCount > 0;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-4 py-2 text-sm rounded-lg border transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan'
                  : 'border-brand-navy-light/30 text-gray-400 hover:text-white'
              }`}
            >
              {tab}
              {showBadge && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-chameleon-amber" />
              )}
            </button>
          );
        })}
      </div>

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-4">
          <pre className="text-sm text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(data.settings, null, 2)}
          </pre>
        </div>
      )}

      {/* MCP Tab */}
      {activeTab === 'mcp' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(data.mcp).length === 0 && (
            <p className="text-gray-500 text-sm col-span-2">No MCP servers configured.</p>
          )}
          {Object.entries(data.mcp).map(([name, config]) => {
            const cfg = config as Record<string, unknown>;
            return (
              <div
                key={name}
                className="p-4 bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg hover:border-brand-cyan/20 transition-colors"
              >
                <p className="text-brand-cyan text-sm font-medium mb-3">{name}</p>
                {cfg.command != null && (
                  <div className="mb-2">
                    <p className="text-gray-500 text-xs">Command</p>
                    <p className="text-white text-sm font-mono">{String(cfg.command)}</p>
                  </div>
                )}
                {Array.isArray(cfg.args) && (
                  <div className="mb-2">
                    <p className="text-gray-500 text-xs">Args</p>
                    <p className="text-gray-300 text-xs font-mono break-all">
                      {(cfg.args as string[]).join(' ')}
                    </p>
                  </div>
                )}
                {cfg.env != null && typeof cfg.env === 'object' && (
                  <div>
                    <p className="text-gray-500 text-xs">Environment</p>
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(cfg.env as Record<string, string>).map(([k, v]) => (
                        <p key={k} className="text-xs font-mono">
                          <span className="text-chameleon-amber">{k}</span>
                          <span className="text-gray-500">=</span>
                          <span className="text-gray-400">{typeof v === 'string' && v.length > 20 ? v.slice(0, 20) + '...' : String(v)}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Plugins Tab */}
      {activeTab === 'plugins' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.plugins.length === 0 && (
            <p className="text-gray-500 text-sm col-span-2">No plugins installed.</p>
          )}
          {data.plugins.map(plugin => (
            <div
              key={plugin.name}
              className="p-4 bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg hover:border-brand-cyan/20 transition-colors"
            >
              <p className="text-white text-sm font-medium">{plugin.name}</p>
              <div className="mt-2 space-y-1 text-xs">
                <p className="text-gray-400">Scope: <span className="text-chameleon-purple">{plugin.scope}</span></p>
                <p className="text-gray-400">Installed: <span className="text-gray-300">{new Date(plugin.installedAt).toLocaleDateString()}</span></p>
                <p className="text-gray-400">Updated: <span className="text-gray-300">{new Date(plugin.lastUpdated).toLocaleDateString()}</span></p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Telemetry Tab */}
      {activeTab === 'telemetry' && (
        <div className="space-y-4">
          {/* Status card */}
          <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-medium">OTEL Configuration Status</h3>
              <span className={`text-xs px-2 py-1 rounded-full font-mono ${
                allPresent
                  ? 'bg-chameleon-green/10 text-chameleon-green border border-chameleon-green/20'
                  : 'bg-chameleon-amber/10 text-chameleon-amber border border-chameleon-amber/20'
              }`}>
                {allPresent ? 'Fully configured' : `${missingCount} key${missingCount !== 1 ? 's' : ''} missing`}
              </span>
            </div>

            <div className="space-y-2">
              {telemetry && Object.entries(telemetry.keys).map(([key, info]) => {
                const desired = OTEL_DESIRED[key];
                const isCorrect = info.present && info.value === desired;
                const isWrong   = info.present && info.value !== desired;
                return (
                  <div key={key} className="flex items-start gap-3 text-sm">
                    <span className={`mt-0.5 text-base shrink-0 ${
                      isCorrect ? 'text-chameleon-green' :
                      isWrong   ? 'text-chameleon-amber' :
                                  'text-gray-600'
                    }`}>
                      {isCorrect ? '✓' : isWrong ? '!' : '○'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-gray-300 font-mono text-xs truncate">{key}</p>
                      {info.present ? (
                        <p className="text-xs font-mono mt-0.5">
                          <span className={isCorrect ? 'text-chameleon-green/80' : 'text-chameleon-amber/80'}>
                            {info.value}
                          </span>
                          {isWrong && (
                            <span className="text-gray-500 ml-2">(expected: {desired})</span>
                          )}
                        </p>
                      ) : (
                        <p className="text-gray-600 text-xs mt-0.5 font-mono">not set</p>
                      )}
                      <p className="text-gray-500 text-xs mt-0.5">{OTEL_KEY_LABELS[key]}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Event stats card */}
          <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-5">
            <h3 className="text-white font-medium mb-3">Ingest Statistics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-500 text-xs">Total events received</p>
                <p className="text-2xl font-mono text-brand-cyan mt-1">
                  {telemetry?.totalEvents ?? 0}
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Last event received</p>
                <p className="text-sm text-gray-300 font-mono mt-1">
                  {telemetry?.lastEventAt
                    ? new Date(telemetry.lastEventAt).toLocaleString()
                    : 'No events yet'}
                </p>
              </div>
            </div>
          </div>

          {/* Setup wizard card */}
          {!allPresent && (
            <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-5">
              <h3 className="text-white font-medium mb-2">Quick Setup</h3>
              <p className="text-gray-400 text-sm mb-4">
                Run the setup wizard to add the missing keys to{' '}
                <code className="text-brand-cyan font-mono text-xs">~/.claude/settings.json</code>.
                Existing values are never overwritten.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={runWizard}
                    disabled={wizardRunning}
                    className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                      wizardRunning
                        ? 'border-brand-navy-light/30 text-gray-600 cursor-not-allowed'
                        : 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan hover:bg-brand-cyan/20'
                    }`}
                  >
                    {wizardRunning ? 'Running...' : 'Apply missing settings'}
                  </button>
                  <span className="text-gray-500 text-xs">or run</span>
                  <code className="text-brand-cyan font-mono text-xs bg-brand-navy-dark/50 px-2 py-1 rounded">
                    npm run setup:otel
                  </code>
                  <span className="text-gray-500 text-xs">from the terminal</span>
                </div>
                {wizardResult && (
                  <p className="text-sm text-gray-300 bg-brand-navy-dark/50 p-3 rounded font-mono">
                    {wizardResult}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  After applying: quit Claude Code and restart it to pick up the new settings.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
