# PRD-407 In-Process Agent Monitor Only

## Scope

Build only PRD-407 from a clean `origin/main` worktree. Do not cherry-pick or copy the broader PRD-428 work.

## Interpretation

Eliminate the spawned Electron-as-Node Agent Monitor sidecar process. Keep the generated Agent Monitor web runtime on a fixed loopback port so the existing iframe, hook handler, and `/api/health` contracts continue to work.

## Plan

1. Generate a `server/closedloop-runtime.js` wrapper from `build-agent-monitor.mjs`. Done.
2. Replace `AgentMonitorSidecar` internals so it loads that wrapper with `createRequire` and starts/stops the runtime in Electron main. Done.
3. Preserve current host contracts: fixed port, health polling, runtime env, sandbox env, hook opt-in, shutdown ordering, reprocess flow. Done.
4. Remove child-process supervision expectations from tests and add guards for the in-process runtime. Done.
5. Verify with `build:agent-monitor`, focused tests, `typecheck`, full desktop tests, runtime health smoke, and port-conflict smoke. Done.

## Verification

- `pnpm -C apps/desktop exec node --check scripts/build-agent-monitor.mjs`
- `pnpm -C apps/desktop exec tsc -p tsconfig.json --noEmit`
- `pnpm -C apps/desktop build:agent-monitor -- --force`
- `pnpm -C apps/desktop exec tsx --test test/agent-monitor-sidecar.test.ts test/agent-monitor-runtime-env.test.ts test/agent-monitor-wiring-static.test.ts`
- `pnpm -C apps/desktop build`
- `pnpm -C apps/desktop test`
- Runtime smoke on `127.0.0.1:54821` returned `/api/health` 200 and confirmed host `process.env`/`process.cwd()` stayed isolated.
- Port-conflict smoke on `127.0.0.1:54822` rejected with `EADDRINUSE` and restored host env.
- Independent PR review found no material findings after fixes.
- `git diff --check`

## Non-Goals

- No PRD-428 strategy items.
- No single-player nav changes.
- No Codex hook work beyond what already exists on `origin/main`.
- No pricing/audit/catalog feature changes beyond what is necessary for PRD-407 runtime lifecycle.
- No commits or pushes.
