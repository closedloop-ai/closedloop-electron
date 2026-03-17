# ClosedLoop Electron Monorepo

## Structure

- `apps/desktop/` -- Electron desktop app (localhost HTTP gateway, cloud relay, tray UI)

## Useful Commands

Run `just` to see all available recipes. Key ones:

- `just desktop-dev` -- build and start Electron
- `just desktop-no-auth` -- start with gateway auth disabled (dev only)
- `just desktop-debug-auth` -- start with debug token minting enabled
- `just desktop-lint` -- run ESLint
- `just desktop-typecheck` -- run TypeScript type checking
- `just desktop-test` -- run tests

## Commit Messages

Follow the format in `.gitmessage`. The subject line must be `<TICKET>: <description>` where TICKET is extracted from the branch name (e.g. `FEAT-68: add no-auth dev mode`). Include bullet-point body, Testing, and Risks sections.
