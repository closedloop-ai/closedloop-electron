import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { Card, CardContent } from "@closedloop-ai/design-system/components/ui/card";

interface LogEntry {
  timestamp?: string;
  level?: string;
  message?: string;
  text?: string;
}

export function LogsPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [verbose, setVerbose] = useState(false);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await window.desktopApi.getLogs();
      const raw = (data as LogEntry[]) ?? [];
      setEntries(raw);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [paused, load]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  useEffect(() => {
    if (autoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  const handleClear = async () => {
    await window.desktopApi.clearLogs();
    await load();
  };

  const handleOpenFile = async () => {
    await window.desktopApi.openLogFile();
  };

  const filtered = verbose ? entries : entries.filter((e) => {
    const msg = e.message ?? e.text ?? "";
    return !msg.startsWith("[debug") && !msg.startsWith("[trace");
  });

  const levelColor = (level?: string) => {
    if (!level) return "";
    const l = level.toLowerCase();
    if (l === "error" || l === "fatal") return "text-[var(--destructive)]";
    if (l === "warn" || l === "warning") return "text-[var(--warning)]";
    if (l === "info") return "text-[var(--info)]";
    return "text-[var(--muted-foreground)]";
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Diagnostics</h2>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} className="rounded" />
              Verbose
            </label>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={load} title="Refresh">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5">
                <path d="M1.5 1.5v4.5h4.5"/><path d="M2.3 10a6 6 0 1 0 .9-4.8L1.5 6"/>
              </svg>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPaused((p) => !p)} title={paused ? "Resume" : "Pause"}>
              {paused ? "▶" : "⏸"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleOpenFile} title="Open log file">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-3.5">
                <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6"/><path d="M9 2v4h4"/><path d="M6 10h4"/>
              </svg>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClear} title="Clear logs">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5">
                <line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/>
              </svg>
            </Button>
          </div>

          {paused && (
            <div className="text-xs text-[var(--warning)] mb-2 px-2 py-1 rounded bg-[var(--warning)]/10">Paused</div>
          )}

          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="max-h-[60vh] overflow-y-auto font-mono text-xs leading-relaxed space-y-0.5"
          >
            {filtered.length === 0 ? (
              <p className="text-[var(--muted-foreground)] py-4 text-center">No log entries</p>
            ) : (
              filtered.slice(-500).map((e, i) => {
                const msg = e.message ?? e.text ?? "";
                const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "";
                return (
                  <div key={i} className="flex gap-2">
                    <span className="shrink-0 text-[var(--muted-foreground)] w-16">{time}</span>
                    <span className={`shrink-0 w-12 ${levelColor(e.level)}`}>{e.level ?? ""}</span>
                    <span className="break-all">{msg}</span>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
