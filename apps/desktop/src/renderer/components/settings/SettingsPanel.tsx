import { useState, useEffect } from "react";
import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";
import { Input } from "@closedloop-ai/design-system/components/ui/input";
import { Switch } from "@closedloop-ai/design-system/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@closedloop-ai/design-system/components/ui/tabs";

type SettingsTab = "relay-gateway" | "security" | "policies" | "binary-paths" | "labs";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "relay-gateway", label: "Relay / Gateway" },
  { id: "security", label: "Security" },
  { id: "policies", label: "Policies" },
  { id: "binary-paths", label: "CLI Tools" },
  { id: "labs", label: "Labs" },
];

function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((item) => item.id === value);
}

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
    const handler = (e: CustomEvent<string>) => {
      if (isSettingsTab(e.detail)) {
        setTab(e.detail);
      }
    };
    window.addEventListener("desktop:navigate-settings-tab", handler as EventListener);
    return () => window.removeEventListener("desktop:navigate-settings-tab", handler as EventListener);
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">Settings</h2>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isSettingsTab(value)) {
            setTab(value);
          }
        }}
      >
        <TabsList>
          {SETTINGS_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="relay-gateway">
          <RelayGatewayTab settings={settings} />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab settings={settings} />
        </TabsContent>
        <TabsContent value="policies">
          <PoliciesTab settings={settings} />
        </TabsContent>
        <TabsContent value="binary-paths">
          <BinaryPathsTab />
        </TabsContent>
        <TabsContent value="labs">
          <LabsTab settings={settings} onSettingsChange={setSettings} />
        </TabsContent>
      </Tabs>
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

  const handlePauseToggle = async (next: boolean) => {
    await window.desktopApi.setCloudCommandsPaused(next);
    setPaused(next);
  };

  const handleConnectionToggle = async (next: boolean) => {
    await window.desktopApi.setCloudConnectionEnabled(next);
    setConnected(next);
  };

  const handleHooksToggle = async (next: boolean) => {
    const result = await window.desktopApi.setAgentMonitorHooksEnabled(next);
    setHooksEnabled(result.enabled);
  };

  const handleCodexToggle = async (next: boolean) => {
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
          <Switch checked={paused} onCheckedChange={handlePauseToggle} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Cloud Connection</p>
            <p className="text-xs text-[var(--muted-foreground)]">Enable cloud relay connection</p>
          </div>
          <Switch checked={connected} onCheckedChange={handleConnectionToggle} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Claude Code Session Tracking</p>
            <p className="text-xs text-[var(--muted-foreground)]">Receive live session events from Claude Code</p>
          </div>
          <Switch checked={hooksEnabled} onCheckedChange={handleHooksToggle} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Codex Session Tracking</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Also track OpenAI Codex sessions via {"~/.codex/hooks.json"} (requires Claude Code tracking on; enable Codex hooks in {"~/.codex/config.toml"})
            </p>
          </div>
          <Switch checked={codexOptIn} onCheckedChange={handleCodexToggle} disabled={!hooksEnabled} />
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

  const handleDangerousToggle = async (next: boolean) => {
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
              <Input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSetApiKey(); }}
                placeholder="sk_live_..."
                autoComplete="off"
                className="flex-1 font-mono text-xs"
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
            <Switch
              checked={dangerousAutoApprove}
              onCheckedChange={handleDangerousToggle}
              className="data-[state=checked]:bg-[var(--destructive)]"
            />
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
                    <Input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSave(tool); if (e.key === "Escape") setEditing(null); }}
                      autoFocus
                      className="mt-1 w-full font-mono text-xs"
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
  { key: "agentMonitorEnabled", label: "Agent Dashboard", description: "Enable the local PGlite-backed Agent Dashboard.", category: "Monitoring", requiresRestart: true },
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
                      <Badge variant="outline" className="text-[10px]">{flag.category}</Badge>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{flag.description}</p>
                    {flag.requiresRestart && (
                      <p className="text-[10px] text-[var(--warning-foreground)] mt-0.5">Requires restart</p>
                    )}
                  </div>
                  <Switch
                    checked={value}
                    onCheckedChange={() => handleToggle(flag.key, value)}
                    disabled={saving === flag.key}
                    className="ml-3 shrink-0"
                  />
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
