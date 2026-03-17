set shell := ["bash", "-cu"]

# Show available recipes.
default:
  @just --list

# Install all workspace dependencies.
install:
  pnpm install

# Build all packages in this workspace.
build:
  pnpm build

# Run all tests in this workspace.
test:
  pnpm test

# Run typechecking across the workspace.
typecheck:
  pnpm typecheck

# Build only the desktop app.
desktop-build:
  pnpm -C apps/desktop build

# Run only desktop app tests.
desktop-test:
  pnpm -C apps/desktop test

# Run typecheck for desktop app only.
desktop-typecheck:
  pnpm -C apps/desktop typecheck

# Build desktop app and start Electron.
desktop-dev:
  pnpm -C apps/desktop dev

# Start Electron from existing desktop build output.
desktop-start:
  pnpm -C apps/desktop start

# Package desktop app as a universal macOS DMG.
desktop-package:
  pnpm -C apps/desktop package

# Start Electron in debug-auth mode (dev-only, enables debug token minting).
desktop-debug-auth:
  CL_LOCAL_GATEWAY_DEBUG_AUTH=1 pnpm -C apps/desktop dev

# Start Electron with auth disabled (dev-only, all engineer routes are open. For debugging only. Do not use!).
desktop-no-auth:
  CL_LOCAL_GATEWAY_NO_AUTH=1 pnpm -C apps/desktop dev
