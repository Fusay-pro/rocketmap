'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Heading, Text, Dialog, Button, Badge } from '@radix-ui/themes';
import { ThemeToggle } from '@/app/components/ThemeToggle';

interface UsageData {
  tier: string;
  daily: {
    limit: number;
    used: number;
    remaining: number;
    resetsAt: string;
  };
  lifetime: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    lastUsedAt: string | null;
  };
  byDay: Record<string, { cost: number; tokens: number; calls: number }>;
  byFeature: Record<string, { cost: number; tokens: number; calls: number }>;
}

const SETTINGS_KEY = 'rocketmap-settings';

interface Settings {
  defaultMode: 'bmc' | 'lean';
  accentColor: string;
}

const defaultSettings: Settings = {
  defaultMode: 'bmc',
  accentColor: 'iris',
};

const accentColors = [
  { name: 'iris', color: '#6366f1' },
  { name: 'violet', color: '#8b5cf6' },
  { name: 'cyan', color: '#06b6d4' },
  { name: 'pink', color: '#ec4899' },
  { name: 'amber', color: '#f59e0b' },
];

interface AnthropicKeyStatus {
  hasKey: boolean;
  maskedKey: string | null;
}

interface SettingsClientProps {
  initialAnthropicKeyStatus: AnthropicKeyStatus;
}

export function SettingsClient({ initialAnthropicKeyStatus }: SettingsClientProps) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [showSaved, setShowSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [anthropicKeyStatus, setAnthropicKeyStatus] = useState<AnthropicKeyStatus>(initialAnthropicKeyStatus);
  const [savingAnthropicKey, setSavingAnthropicKey] = useState(false);
  const [removingAnthropicKey, setRemovingAnthropicKey] = useState(false);
  const [anthropicError, setAnthropicError] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Settings;
        const id = setTimeout(() => setSettings(parsed), 0);
        return () => clearTimeout(id);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetch('/api/usage')
      .then(async (res) => {
        const data = (await res.json()) as UsageData | { error: string };
        if (!res.ok || 'error' in data) {
          throw new Error('error' in data ? data.error : 'Failed to load usage');
        }
        setUsageData(data);
        setUsageLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load usage:', err);
        setUsageLoading(false);
      });
  }, []);

  const saveSettings = useCallback((updated: Settings) => {
    setSettings(updated);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }, []);

  const showSavedToast = useCallback(() => {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }, []);

  const handleSaveAnthropicKey = async () => {
    if (!anthropicApiKey.trim()) {
      setAnthropicError('Enter your AI API key.');
      return;
    }

    setAnthropicError(null);
    setSavingAnthropicKey(true);
    try {
      const res = await fetch('/api/user/anthropic-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: anthropicApiKey.trim() }),
      });

      const data = (await res.json()) as {
        hasKey?: boolean;
        maskedKey?: string | null;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save API key');
      }

      setAnthropicKeyStatus({
        hasKey: Boolean(data.hasKey),
        maskedKey: data.maskedKey ?? null,
      });
      setAnthropicApiKey('');
      showSavedToast();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save API key';
      setAnthropicError(message);
    } finally {
      setSavingAnthropicKey(false);
    }
  };

  const handleRemoveAnthropicKey = async () => {
    setAnthropicError(null);
    setRemovingAnthropicKey(true);
    try {
      const res = await fetch('/api/user/anthropic-key', {
        method: 'DELETE',
      });

      const data = (await res.json()) as {
        hasKey?: boolean;
        maskedKey?: string | null;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove API key');
      }

      setAnthropicKeyStatus({
        hasKey: Boolean(data.hasKey),
        maskedKey: data.maskedKey ?? null,
      });
      setAnthropicApiKey('');
      showSavedToast();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove API key';
      setAnthropicError(message);
    } finally {
      setRemovingAnthropicKey(false);
    }
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      // For MVP, refresh the page - bulk delete would need a dedicated endpoint
      setDeleteOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <div>
          <Heading size="8" style={{ fontFamily: 'var(--font-display)', fontWeight: 400, marginBottom: '0.25rem' }}>
            Settings
          </Heading>
          <Text size="2" style={{ color: 'var(--foreground-muted)' }}>
            Customize your experience
          </Text>
        </div>
        {showSaved && (
          <div className="saved-indicator">
            &#x2713; Saved
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Canvas Defaults</div>
        <Text size="2" style={{ color: 'var(--foreground-muted)', marginBottom: '1rem', display: 'block' }}>
          Choose the default canvas type when creating new canvases.
        </Text>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div
            className="template-card"
            onClick={() => saveSettings({ ...settings, defaultMode: 'bmc' })}
            style={{
              flex: 1,
              borderColor: settings.defaultMode === 'bmc' ? 'color-mix(in srgb, var(--chroma-indigo) 30%, transparent)' : undefined,
              boxShadow: settings.defaultMode === 'bmc' ? '0 0 20px color-mix(in srgb, var(--chroma-indigo) 8%, transparent)' : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.2rem' }}>&#x1F4CA;</span>
              <span className="template-card-title" style={{ marginBottom: 0 }}>BMC</span>
              {settings.defaultMode === 'bmc' && (
                <span style={{ marginLeft: 'auto', color: 'var(--chroma-indigo)', fontSize: '0.75rem' }}>Default</span>
              )}
            </div>
          </div>
          <div
            className="template-card"
            onClick={() => saveSettings({ ...settings, defaultMode: 'lean' })}
            style={{
              flex: 1,
              borderColor: settings.defaultMode === 'lean' ? 'color-mix(in srgb, var(--chroma-cyan) 30%, transparent)' : undefined,
              boxShadow: settings.defaultMode === 'lean' ? '0 0 20px color-mix(in srgb, var(--chroma-cyan) 8%, transparent)' : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.2rem' }}>&#x26A1;</span>
              <span className="template-card-title" style={{ marginBottom: 0 }}>Lean</span>
              {settings.defaultMode === 'lean' && (
                <span style={{ marginLeft: 'auto', color: 'var(--chroma-cyan)', fontSize: '0.75rem' }}>Default</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Appearance</div>
        <Text size="2" style={{ color: 'var(--foreground-muted)', marginBottom: '0.75rem', display: 'block' }}>
          Color mode
        </Text>
        <div style={{ marginBottom: '1.25rem' }}>
          <ThemeToggle variant="segmented" />
        </div>
        <Text size="2" style={{ color: 'var(--foreground-muted)', marginBottom: '1rem', display: 'block' }}>
          Accent color
        </Text>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {accentColors.map((ac) => (
            <div
              key={ac.name}
              className={`color-swatch ${settings.accentColor === ac.name ? 'active' : ''}`}
              style={{ background: ac.color }}
              onClick={() => saveSettings({ ...settings, accentColor: ac.name })}
              title={ac.name}
            />
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">AI Provider</div>
        <Text size="2" style={{ color: 'var(--foreground-muted)', marginBottom: '0.75rem', display: 'block' }}>
          Add your own DeepSeek-compatible API key to run AI with your account and track usage in the dashboard.
          Your daily usage limit still applies.
        </Text>
        {anthropicKeyStatus.hasKey && (
          <Text size="2" style={{ color: 'var(--foreground-muted)', marginBottom: '1rem', display: 'block' }}>
            Current key: <span style={{ fontFamily: 'var(--font-mono)' }}>{anthropicKeyStatus.maskedKey}</span>
          </Text>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input-soft"
            type="password"
            value={anthropicApiKey}
            onChange={(event) => setAnthropicApiKey(event.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
            style={{ minWidth: '280px', flex: 1, padding: '0.65rem 0.8rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
          />
          <Button
            onClick={handleSaveAnthropicKey}
            disabled={savingAnthropicKey}
            style={{ cursor: 'pointer' }}
          >
            {savingAnthropicKey ? 'Saving...' : anthropicKeyStatus.hasKey ? 'Update Key' : 'Save Key'}
          </Button>
          {anthropicKeyStatus.hasKey && (
            <Button
              variant="soft"
              color="red"
              onClick={handleRemoveAnthropicKey}
              disabled={removingAnthropicKey}
              style={{ cursor: 'pointer' }}
            >
              {removingAnthropicKey ? 'Removing...' : 'Remove Key'}
            </Button>
          )}
        </div>
        {anthropicError && (
          <Text size="2" style={{ color: 'var(--state-critical)', marginTop: '0.75rem', display: 'block' }}>
            {anthropicError}
          </Text>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">AI Usage</div>
        {usageLoading ? (
          <Text size="2" style={{ color: 'var(--foreground-muted)' }}>Loading usage data...</Text>
        ) : !usageData ? (
          <Text size="2" style={{ color: 'var(--foreground-muted)' }}>Unable to load usage data.</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Tier badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Badge color={usageData.tier === 'pro' ? 'green' : 'gray'} size="2">
                {usageData.tier === 'pro' ? 'Pro' : 'Free'}
              </Badge>
            </div>

            {/* Daily budget meter */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <Text size="2" style={{ color: 'var(--foreground-muted)' }}>
                  Daily budget
                </Text>
                <Text size="2" style={{ fontFamily: 'var(--font-mono)' }}>
                  ${usageData.daily.used.toFixed(2)} / ${usageData.daily.limit.toFixed(2)}
                </Text>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, (usageData.daily.used / usageData.daily.limit) * 100)}%`,
                    height: '100%',
                    background: 'var(--chroma-indigo)',
                    borderRadius: '4px',
                    transition: 'width 300ms ease',
                  }}
                />
              </div>
              <Text size="1" style={{ color: 'var(--foreground-muted)', marginTop: '0.35rem', display: 'block' }}>
                Resets at {new Date(usageData.daily.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </div>

            {/* Lifetime stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
              <div style={{ background: 'var(--canvas-surface)', borderRadius: '8px', padding: '0.75rem' }}>
                <Text size="1" style={{ color: 'var(--foreground-muted)', display: 'block', marginBottom: '0.25rem' }}>Calls</Text>
                <Text size="4" weight="bold" style={{ fontFamily: 'var(--font-mono)' }}>{usageData.lifetime.calls.toLocaleString()}</Text>
              </div>
              <div style={{ background: 'var(--canvas-surface)', borderRadius: '8px', padding: '0.75rem' }}>
                <Text size="1" style={{ color: 'var(--foreground-muted)', display: 'block', marginBottom: '0.25rem' }}>Input Tokens</Text>
                <Text size="4" weight="bold" style={{ fontFamily: 'var(--font-mono)' }}>{usageData.lifetime.inputTokens.toLocaleString()}</Text>
              </div>
              <div style={{ background: 'var(--canvas-surface)', borderRadius: '8px', padding: '0.75rem' }}>
                <Text size="1" style={{ color: 'var(--foreground-muted)', display: 'block', marginBottom: '0.25rem' }}>Output Tokens</Text>
                <Text size="4" weight="bold" style={{ fontFamily: 'var(--font-mono)' }}>{usageData.lifetime.outputTokens.toLocaleString()}</Text>
              </div>
              <div style={{ background: 'var(--canvas-surface)', borderRadius: '8px', padding: '0.75rem' }}>
                <Text size="1" style={{ color: 'var(--foreground-muted)', display: 'block', marginBottom: '0.25rem' }}>Est. Cost</Text>
                <Text size="4" weight="bold" style={{ fontFamily: 'var(--font-mono)' }}>
                  ${usageData.lifetime.estimatedCostUsd.toFixed(2)}
                </Text>
              </div>
            </div>

            {/* Per-feature breakdown */}
            {Object.keys(usageData.byFeature).length > 0 && (
              <div>
                <Text size="2" weight="bold" style={{ marginBottom: '0.5rem', display: 'block' }}>Per-feature breakdown</Text>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {Object.entries(usageData.byFeature).map(([feature, stats]) => (
                    <div key={feature} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--canvas-surface)', borderRadius: '6px' }}>
                      <Text size="2" style={{ textTransform: 'capitalize' }}>{feature.replace(/-/g, ' ')}</Text>
                      <div style={{ display: 'flex', gap: '1rem', fontFamily: 'var(--font-mono)' }}>
                        <Text size="1" style={{ color: 'var(--foreground-muted)' }}>{stats.calls.toLocaleString()} calls</Text>
                        <Text size="1" style={{ color: 'var(--foreground-muted)' }}>{stats.tokens.toLocaleString()} tokens</Text>
                        <Text size="1" style={{ color: 'var(--foreground-muted)', minWidth: '3.5rem', textAlign: 'right' }}>${stats.cost.toFixed(2)}</Text>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">About</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <Text size="2" style={{ color: 'var(--foreground-muted)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground-subtle)' }}>Version</span>{' '}
            0.1.0-beta
          </Text>
          <Text size="2" style={{ color: 'var(--foreground-muted)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground-subtle)' }}>Engine</span>{' '}
            RocketMap Playable Business Model
          </Text>
        </div>
      </div>

      <div className="settings-section danger-zone">
        <div className="settings-section-title" style={{ color: 'var(--state-critical)' }}>
          Danger Zone
        </div>
        <Text size="2" style={{ color: 'var(--foreground-muted)', marginBottom: '1rem', display: 'block' }}>
          Destructive actions that cannot be undone.
        </Text>
        <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
          <Dialog.Trigger>
            <Button variant="outline" color="red" style={{ cursor: 'pointer' }}>
              Delete All Canvases
            </Button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="400px">
            <Dialog.Title>Delete All Canvases</Dialog.Title>
            <Dialog.Description size="2">
              This will permanently delete all your canvases and their data. This action cannot be undone.
            </Dialog.Description>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <Dialog.Close>
                <Button variant="soft" color="gray" style={{ cursor: 'pointer' }}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                variant="solid"
                color="red"
                onClick={handleDeleteAll}
                disabled={deleting}
                style={{ cursor: 'pointer' }}
              >
                {deleting ? 'Deleting...' : 'Delete Everything'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Root>
      </div>
    </>
  );
}
