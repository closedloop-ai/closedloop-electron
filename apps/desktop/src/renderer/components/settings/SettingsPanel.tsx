import { useState, useEffect } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";

type SettingsTab = "relay-gateway" | "security" | "policies" | "binary-paths" | "labs";

/** Renderer view of ApiKeyStore.getStatus() (src/main/api-key-store.ts). */
interface ApiKeyStatusView {
  hasApiKey: boolean;
  source: "safeStorage" | "environment" | "none";
  environmentVariable?: string;
  provenance?: string;
}

export function SettingsPanel() {
  const [tab, setTab] = useState<SettingsTab>("relay-gateway");
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    window.desktopApi.getSettings().then((s) => setSettings(s as Record<string, unknown>));
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<string>) => setTab(e.detail as SettingsTab);
    window.addEventListener("desktop:navigate-settings-tab", handler as EventListener);
    return () => window.removeEventListener("desktop:navigate-settings-tab", handler as EventListener);
  }, []);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "relay-gateway", label: "Relay / Gateway" },
    { id: "security", label: "Security" },
    { id: "policies", label: "Policies" },
    { id: "binary-paths", label: "CLI Tools" },
    { id: "labs", label: "Labs" },
  ];

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">Settings</h2>

      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === t.id
                ? "border-[var(--primary)] text-[var(--foreground)] font-medium"
                : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "relay-gateway" && <RelayGatewayTab settings={settings} />}
      {tab === "security" && <SecurityTab settings={settings} />}
      {tab === "policies" && <PoliciesTab settings={settings} />}
      {tab === "binary-paths" && <BinaryPathsTab />}
      {tab === "labs" && <LabsTab settings={settings} onSettingsChange={setSettings} />}
    </div>
  );
}

function RelayGatewayTab({ settings }: { settings: Record<string, unknown> | null }) {
  const [runtime, setRuntime] = useState<Record<string, unknown> | null>(null);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(true);
  const [hooksEnabled, setHooksEnabled] = useState(false);
  const [codexOptIn, setCodexOptIn] = useState(false);

  useEffect(() => {
    window.desktopApi.getRuntimeStatus().then((r) => setRuntime(r as Record<string, unknown>));
    window.desktopApi.getCloudCommandsPaused().then((p) => setPaused(p as boolean));
    window.desktopApi.getCloudConnectionEnabled().then((c) => setConnected(c as boolean));
    window.desktopApi.getAgentMonitorHooksEnabled().then((h) => setHooksEnabled(h as boolean));
    window.desktopApi.getAgentMonitorCodexHooksOptIn().then((c) => setCodexOptIn(c as boolean));
  }, []);

  const handlePauseToggle = async () => {
    const next = !paused;
    await window.desktopApi.setCloudCommandsPaused(next);
    setPaused(next);
  };

  const handleConnectionToggle = async () => {
    const next = !connected;
    await window.desktopApi.setCloudConnectionEnabled(next);
    setConnected(next);
  };

  const handleHooksToggle = async () => {
    const next = !hooksEnabled;
    const result = await window.desktopApi.setAgentMonitorHooksEnabled(next);
    setHooksEnabled(result.enabled);
  };

  const handleCodexToggle = async () => {
    const next = !codexOptIn;
    const result = await window.desktopApi.setAgentMonitorCodexHooksOptIn(next);
    if (result.ok) {
      setCodexOptIn(next);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Connection Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-[var(--muted-foreground)]">Gateway Port</p>
              <p className="text-sm font-semibold">{(runtime?.port as string) ?? "..."}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted-foreground)]">Cloud Connection</p>
              <p className={`text-sm font-semibold ${connected ? "text-[var(--success)]" : "text-[var(--destructive)]"}`}>
                {connected ? "Connected" : "Disconnected"}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted-foreground)]">Remote Commands</p>
              <p className={`text-sm font-semibold ${paused ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>
                {paused ? "Paused" : "Active"}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted-foreground)]">Security</p>
              <p className="text-sm font-semibold">{(runtime?.security as string) ?? "..."}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ConfigRow label="Compute Target" value={runtime?.targetId as string} mono />
          <ConfigRow label="Relay Origin" value={settings?.relayOrigin as string} mono />
          <ConfigRow label="API Origin" value={settings?.apiOrigin as string} mono />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Pause Incoming Commands</p>
            <p className="text-xs text-[var(--muted-foreground)]">Pause processing of remote commands</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={paused} onChange={handlePauseToggle} className="sr-only peer" />
            <div className="w-9 h-5 bg-[var(--muted)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--primary)]" />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Cloud Connection</p>
            <p className="text-xs text-[var(--muted-foreground)]">Enable cloud relay connection</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={connected} onChange={handleConnectionToggle} className="sr-only peer" />
            <div className="w-9 h-5 bg-[var(--muted)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--primary)]" />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Claude Code Session Tracking</p>
            <p className="text-xs text-[var(--muted-foreground)]">Receive live session events from Claude Code</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={hooksEnabled} onChange={handleHooksToggle} className="sr-only peer" />
            <div className="w-9 h-5 bg-[var(--muted)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--primary)]" />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Codex Session Tracking</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Also track OpenAI Codex sessions via {"~/.codex/hooks.json"} (requires Claude Code tracking on; enable Codex hooks in {"~/.codex/config.toml"})
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={codexOptIn} onChange={handleCodexToggle} disabled={!hooksEnabled} className="sr-only peer" />
            <div className="w-9 h-5 bg-[var(--muted)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--primary)] peer-disabled:opacity-40" />
          </label>
        </div>
      </div>
    </div>
  );
}

function SecurityTab({ settings }: { settings: Record<string, unknown> | null }) {
  const [dangerousAutoApprove, setDangerousAutoApprove] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatusView | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  const refreshApiKeyStatus = async () => {
    const status = await window.desktopApi.getApiKeyStatus();
    setApiKeyStatus(status as ApiKeyStatusView);
  };

  useEffect(() => {
    window.desktopApi.getDangerousAutoApprove().then(setDangerousAutoApprove);
    void refreshApiKeyStatus();
  }, []);

  const handleDangerousToggle = async () => {
    const next = !dangerousAutoApprove;
    await window.desktopApi.setDangerousAutoApprove(next);
    setDangerousAutoApprove(next);
  };

  const handleSetApiKey = async () => {
    const value = apiKeyInput.trim();
    if (!value) return;
    setApiKeyBusy(true);
    setApiKeyError(null);
    try {
      await window.desktopApi.setApiKey(value);
      setApiKeyInput("");
      await refreshApiKeyStatus();
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : "Failed to set API key");
    } finally {
      setApiKeyBusy(false);
    }
  };

  const handleClearApiKey = async () => {
    setApiKeyBusy(true);
    setApiKeyError(null);
    try {
      await window.desktopApi.clearApiKey();
      setApiKeyInput("");
      await refreshApiKeyStatus();
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : "Failed to clear API key");
    } finally {
      setApiKeyBusy(false);
    }
  };

  const apiKeyConfigured = apiKeyStatus?.hasApiKey === true;
  const apiKeyFromEnv = apiKeyStatus?.source === "environment";
  const apiKeyValueLabel = !apiKeyStatus
    ? "..."
    : apiKeyConfigured
      ? `Configured (${apiKeyStatus.source}${apiKeyStatus.provenance ? `, ${apiKeyStatus.provenance}` : ""})`
      : "Not configured";

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Security Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ConfigRow label="API Key" value={apiKeyValueLabel} />
          <ConfigRow label="Auth Mode" value={(settings?.authMode as string) ?? "standard"} />

          <div className="space-y-2 pt-2 border-t">
            <p className="text-sm font-medium">Manage API Key</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {apiKeyFromEnv
                ? "An API key is provided via an environment variable. Setting one here stores an encrypted key that takes precedence."
                : "Set a ClosedLoop API key (starts with sk_live_). It is stored encrypted at rest."}
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSetApiKey(); }}
                placeholder="sk_live_..."
                autoComplete="off"
                className="flex-1 text-xs font-mono bg-[var(--input)] border rounded px-2 py-1 text-[var(--foreground)]"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSetApiKey}
                disabled={apiKeyBusy || apiKeyInput.trim().length === 0}
              >
                Set
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearApiKey}
                disabled={apiKeyBusy || !apiKeyConfigured}
                className="text-[var(--destructive)]"
              >
                Clear
              </Button>
            </div>
            {apiKeyError && (
              <p className="text-xs text-[var(--destructive)]">{apiKeyError}</p>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <div>
              <p className="text-sm font-medium text-[var(--destructive)]">Dangerous Auto-Approve</p>
              <p className="text-xs text-[var(--muted-foreground)]">Automatically approve all commands — use with extreme caution</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={dangerousAutoApprove} onChange={handleDangerousToggle} className="sr-only peer" />
              <div className="w-9 h-5 bg-[var(--muted)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--destructive)]" />
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PoliciesTab({ settings }: { settings: Record<string, unknown> | null }) {
  const rules = (settings?.alwaysAllowRules as Array<{ id: string; description?: string; command?: string }>) ?? [];

  const handleRemoveRule = async (ruleId: string) => {
    await window.desktopApi.removeAlwaysAllowRule(ruleId);
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Always Allow Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-4">No always-allow rules configured</p>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between border rounded p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{rule.description ?? "Rule"}</p>
                    {rule.command && <p className="truncate text-xs text-[var(--muted-foreground)] font-mono">{rule.command}</p>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleRemoveRule(rule.id)} className="text-[var(--destructive)] shrink-0 ml-2">Remove</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BinaryPathsTab() {
  const [binaries, setBinaries] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    window.desktopApi.getBinaryPaths().then((b) => {
      setBinaries(b as Record<string, string>);
      setLoading(false);
    });
  }, []);

  const handleDetect = async () => {
    setLoading(true);
    await window.desktopApi.detectCliTools();
    const b = await window.desktopApi.getBinaryPaths();
    setBinaries(b as Record<string, string>);
    setLoading(false);
  };

  const startEdit = (tool: string) => {
    setEditing(tool);
    setEditValue(binaries[tool] ?? "");
  };

  const handleSave = async (tool: string) => {
    if (editValue) {
      await window.desktopApi.patchBinaryPaths({ [tool]: editValue });
      const b = await window.desktopApi.getBinaryPaths();
      setBinaries(b as Record<string, string>);
    }
    setEditing(null);
  };

  const BINARY_TOOLS = ["claude", "node", "git", "bash", "python3"];

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>CLI Tools</CardTitle>
            <Button variant="outline" size="sm" onClick={handleDetect} disabled={loading}>Detect Tools</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-4">Detecting tools...</p>
          ) : (
            BINARY_TOOLS.map((tool) => (
              <div key={tool} className="flex items-center justify-between border rounded p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{tool}</p>
                  {editing === tool ? (
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSave(tool); if (e.key === "Escape") setEditing(null); }}
                      autoFocus
                      className="mt-1 w-full text-xs font-mono bg-[var(--input)] border rounded px-2 py-1 text-[var(--foreground)]"
                      placeholder={`/usr/bin/${tool}`}
                    />
                  ) : (
                    <p className="text-xs text-[var(--muted-foreground)] font-mono truncate max-w-[300px]">
                      {binaries[tool] ?? "Not found"}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 ml-2 shrink-0">
                  {editing === tool ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => handleSave(tool)}>Save</Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => startEdit(tool)}>Edit</Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const LAB_FLAGS: { key: string; label: string; description: string; category: string; requiresRestart?: boolean }[] = [
  { key: "agentMonitorEnabled", label: "Agent Dashboard", description: "Enable the Claude Dashboard for session and agent observability.", category: "Monitoring" },
  { key: "planExtractionEnabled", label: "Plan Extraction", description: "Enable Plans / plan extraction UI in the Agent Dashboard.", category: "Monitoring" },
  { key: "commandSigningEnforcementEnabled", label: "Command Signing Enforcement", description: "Require ED25519 signatures on browser commands.", category: "Security", requiresRestart: true },
  { key: "verboseLogging", label: "Verbose Logging", description: "Enable verbose gateway logging for debugging.", category: "Debugging" },
];

function LabsTab({ settings, onSettingsChange }: { settings: Record<string, unknown> | null; onSettingsChange: (s: Record<string, unknown>) => void }) {
  const [saving, setSaving] = useState<string | null>(null);

  const handleToggle = async (key: string, currentValue: boolean) => {
    setSaving(key);
    try {
      await window.desktopApi.updateSettings({ [key]: !currentValue });
      const updated = await window.desktopApi.getSettings();
      onSettingsChange(updated as Record<string, unknown>);
    } catch { /* ignore */ }
    setSaving(null);
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Labs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            Early access to experimental features and advanced controls.
          </p>
          <div className="space-y-3">
            {LAB_FLAGS.map((flag) => {
              const value = settings?.[flag.key] === true;
              return (
                <div key={flag.key} className="flex items-center justify-between border rounded p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{flag.label}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">{flag.category}</span>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{flag.description}</p>
                    {flag.requiresRestart && (
                      <p className="text-[10px] text-[var(--warning-foreground)] mt-0.5">Requires restart</p>
                    )}
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer ml-3 shrink-0">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={() => handleToggle(flag.key, value)}
                      disabled={saving === flag.key}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[var(--muted)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--primary)]" />
                  </label>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-[var(--muted-foreground)] w-24 shrink-0">{label}</span>
      <span className={`truncate ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}
