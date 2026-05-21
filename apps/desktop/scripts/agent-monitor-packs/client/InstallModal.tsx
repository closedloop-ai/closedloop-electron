/**
 * @file InstallModal.tsx — SSE-streamed install/uninstall runner (FEA-1314).
 * Shows the verbatim command, runs it on user confirmation, streams stdout/
 * stderr into a scrolling <pre>, and surfaces the exit code with a
 * "Rescan packs" button once the run completes.
 */
import { useEffect, useRef, useState } from "react";

const TRUSTED_ACTION_HEADER = "x-agent-dashboard-trusted-action";
const TRUSTED_ACTION_VALUE = "catalog-mutate";

/** POSIX single-quote escape — wraps a path so it can be safely interpolated
 *  into a shell command. Handles embedded single quotes via the classic
 *  `'\''` trick. Used for the project cwd prefix in the copy-command UX. */
function shellQuote(s: string): string {
  if (!s) return "''";
  return `'${s.replace(/'/g, "'\\''")}'`;
}

interface PostInstallInfo {
  title: string;
  body: string;
  copy_command?: string;
  url?: string;
  required?: boolean;
}

interface InstallModalProps {
  packId: string;
  packDisplayName: string;
  harness: string;
  action: "install" | "uninstall";
  command: string;
  /** When true, the `command` field is a best-guess preview — the server
   *  picks the actual command to run based on installed CLIs at spawn
   *  time. UI shows a note explaining this. */
  commandIsAutoDetect?: boolean;
  /** Set when the pack's install command operates on `cwd` (BMad et al).
   *  When true, the modal shows a copy-command UX with a project picker
   *  instead of streaming the install — the user runs it in their own
   *  terminal where they can answer interactive prompts. */
  projectScoped?: boolean;
  /** Optional next-steps block popped automatically after a successful
   *  install (Claude Code Router, context7 optional Upstash key, future
   *  ClosedLoop MCP). Falls through unchanged for packs without one. */
  postInstall?: PostInstallInfo | null;
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
  commandIsAutoDetect,
  projectScoped,
  postInstall,
  onClose,
  onCompleted,
}: InstallModalProps) {
  // Friendlier label for the "auto" sentinel — most users don't know what
  // "auto" means as a harness value. Shows the actual harnesses the server
  // will pick from instead.
  const harnessLabel =
    harness === "auto" ? "auto-detect (claude + codex)" : harness;
  const [state, setState] = useState<RunState>({ kind: "preview" });
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [copied, setCopied] = useState(false);
  // Post-install screen. Populated either from the seeded `postInstall` prop
  // OR from a `post_install` SSE event the server emits before `complete`.
  // We prefer the server-emitted one since it can carry runtime-resolved
  // values, but fall back to the prop for client-side rendering.
  const [postInstallInfo, setPostInstallInfo] =
    useState<PostInstallInfo | null>(null);
  const [postInstallCopied, setPostInstallCopied] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);

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
      /* best-effort */
    }
  };

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [lines]);

  const runIt = () => {
    setState({ kind: "running" });
    setLines([]);
    setError(null);
    const url = `/api/catalog/${encodeURIComponent(packId)}/${action}?harness=${encodeURIComponent(harness)}`;
    fetch(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        [TRUSTED_ACTION_HEADER]: TRUSTED_ACTION_VALUE,
      },
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          const raw = await res.text().catch(() => "");
          let detail = raw;
          try {
            const parsed = JSON.parse(raw);
            detail = parsed?.error?.message || raw;
          } catch {
            /* leave raw body as-is */
          }
          throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
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
      setLines((prev) => [
        ...prev,
        event === "stderr" ? `[stderr] ${data}` : data,
      ]);
    } else if (event === "post_install") {
      // Server is signalling that this install has required-or-recommended
      // follow-ups. Store the block — the post-install screen renders after
      // `complete` lands.
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === "object" && parsed.title && parsed.body) {
          setPostInstallInfo({
            title: String(parsed.title),
            body: String(parsed.body),
            copy_command: parsed.copy_command,
            url: parsed.url,
            required: Boolean(parsed.required),
          });
        }
      } catch {
        /* malformed — ignore */
      }
    } else if (event === "complete") {
      try {
        const parsed = JSON.parse(data);
        const exitCode =
          typeof parsed.exit_code === "number" ? parsed.exit_code : -1;
        // Promote prop-supplied post_install if the server didn't send one
        // (e.g. older sidecar). Only on a successful install.
        if (
          exitCode === 0 &&
          action === "install" &&
          !postInstallInfo &&
          postInstall
        ) {
          setPostInstallInfo(postInstall);
        }
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
    }
  };

  const title =
    action === "install"
      ? `Install ${packDisplayName}`
      : `Uninstall ${packDisplayName}`;

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
              harness: <span className="font-mono text-gray-300">{harnessLabel}</span>
              {state.kind === "running" && (
                <span className="ml-2 text-amber-300">running…</span>
              )}
              {state.kind === "complete" && (
                <span
                  className={`ml-2 ${state.exitCode === 0 ? "text-emerald-300" : "text-rose-300"}`}
                >
                  exit {state.exitCode}
                  {state.reason && state.reason !== "exit"
                    ? ` (${state.reason})`
                    : ""}
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
                {commandIsAutoDetect && (
                  <span className="ml-2 text-[10px] normal-case font-normal text-gray-400">
                    (preview — server picks the final command based on
                    installed CLIs)
                  </span>
                )}
              </div>
              <pre className="whitespace-pre-wrap break-all text-xs font-mono text-gray-200 bg-surface-2 border border-border rounded-lg p-3 max-h-32 overflow-auto">
                {command || "(server will resolve at install time)"}
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

            {/* Post-install required-or-recommended next steps. Pops only on a
                successful install when the pack has a `post_install` block —
                most packs render nothing here. (Claude Code Router needs
                provider keys; context7 optionally needs an Upstash key; future
                ClosedLoop MCP needs OAuth + API key.) */}
            {state.kind === "complete" &&
              state.exitCode === 0 &&
              action === "install" &&
              postInstallInfo && (
                <div
                  className={`rounded-lg border px-3 py-3 ${
                    postInstallInfo.required
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-sky-500/30 bg-sky-500/5"
                  }`}
                >
                  <div
                    className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${
                      postInstallInfo.required
                        ? "text-amber-300"
                        : "text-sky-300"
                    }`}
                  >
                    {postInstallInfo.required ? "Required next step" : "Next step (optional)"}
                  </div>
                  <div className="text-sm font-medium text-gray-100 mb-1">
                    {postInstallInfo.title}
                  </div>
                  <p className="text-[12px] text-gray-300 mb-3 leading-relaxed">
                    {postInstallInfo.body}
                  </p>
                  {postInstallInfo.copy_command && (
                    <div className="mb-3">
                      <pre className="whitespace-pre-wrap break-all text-[11px] font-mono text-gray-200 bg-black/30 border border-border rounded-lg p-2.5 max-h-32 overflow-auto">
                        {postInstallInfo.copy_command}
                      </pre>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              postInstallInfo.copy_command || "",
                            );
                            setPostInstallCopied(true);
                            setTimeout(() => setPostInstallCopied(false), 1500);
                          } catch {
                            /* best-effort */
                          }
                        }}
                        className="mt-1.5 text-[11px] rounded border border-border bg-surface-3 text-gray-300 px-2 py-1 hover:bg-surface-2"
                      >
                        {postInstallCopied ? "Copied ✓" : "Copy"}
                      </button>
                    </div>
                  )}
                  {postInstallInfo.url && (
                    <a
                      href={postInstallInfo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-accent hover:underline"
                    >
                      Open setup guide →
                    </a>
                  )}
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
