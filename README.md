# ClosedLoop Desktop

Electron desktop app for the [ClosedLoop](https://closedloop.ai) platform. Provides a localhost HTTP gateway that bridges the browser-based web app to local development tools -- git operations, file access, code review, and AI-powered coding sessions.

## Prerequisites

- **Node.js** 22+
- **pnpm** 9.15+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- **just** command runner (`brew install just`)
- **macOS** (Electron desktop builds target macOS only)

## Getting Started

```bash
# Install dependencies
just install

# Build and start the desktop app
just desktop-dev
```

The app binds a local HTTP gateway on port `19432` and shows a tray icon.

## Development

Run `just` to see all available commands. Common ones:

| Command | Description |
|---|---|
| `just desktop-dev` | Build and start Electron |
| `just desktop-no-auth` | Start with gateway auth disabled (dev only) |
| `just desktop-debug-auth` | Start with debug token minting enabled |
| `just desktop-lint` | Run ESLint |
| `just desktop-typecheck` | Run TypeScript type checking |
| `just desktop-test` | Run tests |
| `just desktop-package` | Package as macOS DMG |

## Project Structure

```
apps/
  desktop/          Electron main process, localhost HTTP gateway, tray UI
    src/
      main/         Electron app lifecycle, IPC, cloud relay
      server/       HTTP gateway router, operation handlers
      shared/       Types and utilities shared between main/server
      renderer/     Preload scripts and renderer bridge
    resources/      App icons, tray icons
    scripts/        Build and icon generation scripts
```

## Releases

Releases are automated via CI. Bump the `version` in `apps/desktop/package.json` as part of your PR. When merged to main, CI builds a universal macOS DMG and publishes it to GitHub Releases. Packaged builds auto-update via `electron-updater`.

See [apps/desktop/CLAUDE.md](apps/desktop/CLAUDE.md) for detailed release and development documentation.
