# Repository Guidelines

## Project Structure & Module Organization
This repository is a pnpm workspace with one primary app at `apps/desktop/`.

- `apps/desktop/src/main/`: Electron lifecycle, tray/window boot, cloud relay wiring.
- `apps/desktop/src/server/`: localhost HTTP gateway routes, auth, and operation handlers.
- `apps/desktop/src/shared/`: shared contracts, types, and cross-layer utilities.
- `apps/desktop/src/renderer/`: renderer/preload bridge code.
- `apps/desktop/test/`: integration and unit tests (`*.test.ts`), plus `fixtures/` and helpers.
- `apps/desktop/resources/` and `apps/desktop/scripts/`: icons and build/support scripts.

Generated outputs (`dist/`, `dist-dmg/`) should not be committed.

## Build, Test, and Development Commands
Use `just` recipes from the repo root:

- `just install`: install workspace dependencies.
- `just desktop-dev`: build and run Electron locally.
- `just desktop-start`: run Electron from existing build output.
- `just desktop-lint`: run ESLint for desktop sources.
- `just desktop-typecheck`: run TypeScript `--noEmit`.
- `just desktop-test`: run the desktop test suite.
- `just desktop-package`: build and package a macOS DMG.

Workspace-wide commands are also available: `just build`, `just test`, `just typecheck`.

## Coding Style & Naming Conventions
TypeScript is strict-mode (`tsconfig.base.json`) and ESM (`NodeNext`).

- Follow existing style: 2-space indentation, semicolons, double quotes.
- Prefer `kebab-case` file names (for example, `gateway-auth.ts`).
- Keep boundaries clear between `main`, `server`, and `shared` modules.
- Prefix intentionally unused variables/args with `_` to satisfy lint rules.
- Do not edit `apps/desktop/src/shared/build-info.ts` manually (auto-generated in prebuild).

## Testing Guidelines
Tests run with `tsx --test` (Node test runner) via `just desktop-test`.

- Place tests in `apps/desktop/test/` and name files `*.test.ts`.
- Add or update tests with behavior changes, especially gateway auth, process spawning, and telemetry flows.
- Before opening a PR, run: `just desktop-lint && just desktop-typecheck && just desktop-test`.

## Commit & Pull Request Guidelines
Commit format follows `.gitmessage` and recent history:

- Subject: `<TICKET>: <imperative summary>` (example: `PLN-276: Add binary path overrides`).
- Body: short bullet list of key changes.
- Footer sections: `Testing:` and `Risks:`.

PRs should target `main`, explain what changed and why, link the ticket, and include screenshots/log snippets when UI or gateway behavior changes. Any PR that changes files under `apps/desktop/` must include a version bump in `apps/desktop/package.json`. If the current branch already has a version bump in `apps/desktop/package.json` (committed or uncommitted), do not bump again.
