/**
 * @file InstallModal.tsx — SSE-streamed install/uninstall runner (FEA-1314).
 * Shows the verbatim command, runs it on user confirmation, streams stdout/
 * stderr into a scrolling <pre>, and surfaces the exit code with a
 * "Rescan packs" button once the run completes.
 */
import { useEffect, useRef, useState } from "react";

/** POSIX single-quote escape — wraps a path so it can be safely interpolated
 *  into a shell command. Handles embedded single quotes via the classic
 *  `'\''` trick. Used for the project cwd prefix in the copy-command UX. */
function shellQuote(s: string): string {
  if (!s) return "''";
  return `'${s.replace(/'/g, "'\\''")}'`;
}

interface InstallModalProps {
  packId: string;
  packDisplayName: string;
  harness: string;
  action: "install" | "uninstall";
  command: string;
  /** Set when the pack's install command operates on `cwd` (BMad et al).
   *  When true, the modal shows a copy-command UX with a project picker
   *  instead of streaming the install — the user runs it in their own
   *  terminal where they can answer interactive prompts. */
  projectScoped?: boolean;
  onClose: () => void;
  /** Called after a successful run so the parent can re-fetch the catalog. */
  onCompleted?: (exitCode: number) => void;
}

type RunState =
  | { kind: "preview" }
  | { kind: "running" }
  | { kind: "complete"; exitCode: number; reason?: string };

export function InstallModal({
  packId,
  packDisplayName,
  harness,
  action,
  command,
  projectScoped,
  onClose,
  onCompleted,
}: InstallModalProps) {
  const [state, setState] = useState<RunState>({ kind: "preview" });
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Project-scoped install UX state
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Load recent projects when this is a project-scoped install — populates the
  // dropdown that prefixes the copy-command with `cd <project> && ...`.
  useEffect(() => {
    if (!projectScoped) return;
    fetch("/api/packs/recent-projects")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const list = Array.isArray(d.items) ? d.items : [];
        setProjects(list);
        if (list.length > 0) setSelectedProject(list[0]);
      })
      .catch(() => setProjects([]));
  }, [projectScoped]);

  const fullCopyCommand = selectedProject
    ? `cd ${shellQuote(selectedProject)} && ${command}`
    : command;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullCopyCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort
    }
  };

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    return () => {
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  const runIt = () => {
    setState({ kind: "running" });
    setLines([]);
    setError(null);
    const url = `/api/catalog/${encodeURIComponent(packId)}/${action}?harness=${encodeURIComponent(harness)}`;
    // EventSource only supports GET; fall back to fetch+ReadableStream for SSE-over-POST.
    fetch(url, { method: "POST", headers: { Accept: "text/event-stream" } })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${body ? ": " + body : ""}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // SSE frames are separated by blank lines
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleFrame(frame);
          }
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setState({ kind: "complete", exitCode: -1, reason: "transport" });
      });
  };

  const handleFrame = (frame: string) => {
    const eventLine = frame.split("\n").find((l) => l.startsWith("event:"));
    const dataLines = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart());
    const event = eventLine ? eventLine.slice(6).trim() : "message";
    const data = dataLines.join("\n");
    if (event === "stdout" || event === "stderr") {
      setLines((prev) => [...prev, event === "stderr" ? `[stderr] ${data}` : data]);
    } else if (event === "complete") {
      try {
        const parsed = JSON.parse(data);
        const exitCode = typeof parsed.exit_code === "number" ? parsed.exit_code : -1;
        setState({ kind: "complete", exitCode, reason: parsed.reason });
        if (onCompleted) onCompleted(exitCode);
      } catch {
        setState({ kind: "complete", exitCode: -1, reason: "parse_error" });
      }
    } else if (event === "error") {
      try {
        const parsed = JSON.parse(data);
        setError(parsed.message || data);
      } catch {
        setError(data);
      }
    } else if (event === "start") {
      // no-op; the command was already shown in the preview
    }
  };

  const title =
    action === "install" ? `Install ${packDisplayName}` : `Uninstall ${packDisplayName}`;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && state.kind !== "running") onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-3xl rounded-lg border border-border bg-surface-1 shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-100 truncate">
              {title}
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              harness: <span className="font-mono text-gray-300">{harness}</span>
              {state.kind === "running" && (
                <span className="ml-2 text-amber-300">running…</span>
              )}
              {state.kind === "complete" && (
                <span
                  className={`ml-2 ${state.exitCode === 0 ? "text-emerald-300" : "text-rose-300"}`}
                >
                  exit {state.exitCode}
                  {state.reason && state.reason !== "exit" ? ` (${state.reason})` : ""}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={state.kind === "running"}
            className="text-xs rounded border border-border bg-surface-2 px-2.5 py-1 text-gray-300 hover:bg-surface-3 disabled:opacity-50"
          >
            Close
          </button>
        </div>

        {/* Project-scoped pack: copy-command UX (BMad et al). The installer
            for these packs is interactive in ways our SSE pipe can't handle
            (module selection, IDE choice, etc), so we show the right command
            with a `cd <project>` prefix and let the user run it in their
            own terminal where they can answer the prompts. */}
        {projectScoped ? (
          <div className="p-4 space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
              <strong>{packDisplayName}</strong> installs into your project and
              prompts for choices (module / IDE / etc) — those prompts can't
              be answered from this modal. Pick a project below, copy the
              command, and run it in your terminal.
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Install in project
              </div>
              {projects.length === 0 ? (
                <div className="text-[11px] text-gray-500 italic">
                  No recent project directories found. Open a Claude Code or
                  Codex session in a project, then revisit this modal.
                </div>
              ) : (
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="w-full text-xs font-mono bg-surface-2 border border-border rounded-lg px-3 py-2 text-gray-200"
                >
                  {projects.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Copy + paste into your terminal
              </div>
              <pre className="whitespace-pre-wrap break-all text-xs font-mono text-gray-200 bg-black/30 border border-border rounded-lg p-3 max-h-40 overflow-auto">
                {fullCopyCommand}
              </pre>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="text-xs rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-gray-300 hover:bg-surface-3"
              >
                Cancel
              </button>
              <button
                onClick={handleCopy}
                className="text-xs font-medium rounded-lg border border-accent/40 bg-accent/10 text-accent px-3 py-1.5 hover:bg-accent/20"
              >
                {copied ? "Copied ✓" : "Copy command"}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Command
              </div>
              <pre className="whitespace-pre-wrap break-all text-xs font-mono text-gray-200 bg-surface-2 border border-border rounded-lg p-3 max-h-32 overflow-auto">
                {command}
              </pre>
            </div>

            {error && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            )}

            {(state.kind === "running" || state.kind === "complete") && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Output
                </div>
                <pre
                  ref={preRef}
                  className="whitespace-pre-wrap break-all text-[11px] leading-relaxed text-gray-200 bg-black/30 border border-border rounded-lg p-3 max-h-80 overflow-auto font-mono"
                >
                  {lines.length === 0 ? "(waiting for output…)" : lines.join("")}
                </pre>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              {state.kind === "preview" && (
                <>
                  <button
                    onClick={onClose}
                    className="text-xs rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-gray-300 hover:bg-surface-3"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={runIt}
                    className="text-xs font-medium rounded-lg border border-accent/40 bg-accent/10 text-accent px-3 py-1.5 hover:bg-accent/20"
                  >
                    Run
                  </button>
                </>
              )}
              {state.kind === "complete" && (
                <button
                  onClick={onClose}
                  className="text-xs font-medium rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 px-3 py-1.5 hover:bg-emerald-500/20"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
