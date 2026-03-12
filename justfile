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
