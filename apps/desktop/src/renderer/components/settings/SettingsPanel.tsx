import { useState, useEffect, useCallback } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@closedloop-ai/design-system/components/ui/card";

type SettingsTab = "relay-gateway" | "security" | "policies" | "binary-paths";

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
    </div>
  );
}

function RelayGatewayTab({ settings }: { settings: Record<string, unknown> | null }) {
  const [runtime, setRuntime] = useState<Record<string, unknown> | null>(null);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(true);
  const [hooksEnabled, setHooksEnabled] = useState(false);

  useEffect(() => {
    window.desktopApi.getRuntimeStatus().then((r) => setRuntime(r as Record<string, unknown>));
    window.desktopApi.getCloudCommandsPaused().then((p) => setPaused(p as boolean));
    window.desktopApi.getCloudConnectionEnabled().then((c) => setConnected(c as boolean));
    window.desktopApi.getAgentMonitorHooksEnabled().then((h) => setHooksEnabled(h as boolean));
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
      </div>
    </div>
  );
}

function SecurityTab({ settings }: { settings: Record<string, unknown> | null }) {
  const [dangerousAutoApprove, setDangerousAutoApprove] = useState(false);

  useEffect(() => {
    window.desktopApi.getDangerousAutoApprove().then(setDangerousAutoApprove);
  }, []);

  const handleDangerousToggle = async () => {
    const next = !dangerousAutoApprove;
    await window.desktopApi.setDangerousAutoApprove(next);
    setDangerousAutoApprove(next);
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Security Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ConfigRow label="API Key" value={(settings?.apiKeyStatus ?? "unknown") as string} />
          <ConfigRow label="Auth Mode" value={(settings?.authMode as string) ?? "standard"} />

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

  const handleSave = async (tool: string) => {
    const input = prompt(`Enter path for ${tool}:`, binaries[tool] ?? "");
    if (input) {
      await window.desktopApi.patchBinaryPaths({ [tool]: input });
      const b = await window.desktopApi.getBinaryPaths();
      setBinaries(b as Record<string, string>);
    }
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
                <div>
                  <p className="text-sm font-medium">{tool}</p>
                  <p className="text-xs text-[var(--muted-foreground)] font-mono truncate max-w-[300px]">
                    {binaries[tool] ?? "Not found"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleSave(tool)}>Save</Button>
                </div>
              </div>
            ))
          )}
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
