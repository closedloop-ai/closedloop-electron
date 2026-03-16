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

# Bump desktop app version in package.json (include in your PR before merging).
# CI builds and publishes on merge to main when apps/desktop/** changes.
# Usage: just desktop-bump patch    (0.1.0 → 0.1.1)
#        just desktop-bump minor    (0.1.0 → 0.2.0)
#        just desktop-bump major    (0.1.0 → 1.0.0)
#        just desktop-bump 2.0.0    (explicit version)
desktop-bump bump="patch":
  #!/usr/bin/env bash
  set -euo pipefail
  cd apps/desktop
  NEW_VERSION=$(npm version "{{bump}}" --no-git-tag-version | tr -d 'v')
  echo "Bumped apps/desktop/package.json to v$NEW_VERSION"
  echo "Commit this change as part of your PR."

# Build and publish desktop DMG to GitHub Releases locally (bypasses CI).
desktop-publish:
  #!/usr/bin/env bash
  set -euo pipefail
  if [ -z "${GH_TOKEN:-}" ]; then
    echo "Error: GH_TOKEN is not set. Export a GitHub PAT with repo/contents:write scope." >&2
    exit 1
  fi
  VERSION=$(node -p "require('./apps/desktop/package.json').version")
  pnpm -C apps/desktop release
  echo ""
  echo "Published v$VERSION to GitHub Releases."
