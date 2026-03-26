# Contributing to ClosedLoop Desktop

We welcome contributions! This guide covers everything you need to get started.

## Getting Started

### Prerequisites

- **Node.js** 22+
- **pnpm** 9.15+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- **just** command runner (`brew install just`)
- **macOS** (Electron desktop builds target macOS only)

### Setup

```bash
# Fork on GitHub, then clone your fork
git clone git@github.com:YOUR_USERNAME/closedloop-electron.git
cd closedloop-electron
git remote add upstream git@github.com:closedloop-ai/closedloop-electron.git

# Install dependencies
just install
```

### Verify

```bash
just desktop-test
just desktop-lint
just desktop-typecheck
```

## Development Workflow

All contributions come through forks. External contributors do not have push access to the main repository.

### Fork & Branch

1. [Fork](https://github.com/closedloop-ai/closedloop-electron/fork) the repository on GitHub
2. Clone your fork and add the upstream remote:
   ```bash
   git clone git@github.com:YOUR_USERNAME/closedloop-electron.git
   cd closedloop-electron
   git remote add upstream git@github.com:closedloop-ai/closedloop-electron.git
   ```
3. Create a feature branch from `main`:
   ```bash
   git fetch upstream
   git checkout -b feat/my-change upstream/main
   ```

### Branch Naming

- `feat/*` — New features
- `fix/*` — Bug fixes
- `docs/*` — Documentation changes
- `refactor/*` — Code restructuring

### Keeping Your Fork Up to Date

```bash
git fetch upstream
git rebase upstream/main
```

### Pull Request Process

1. Push your branch to **your fork** (not the upstream repo)
2. Open a PR from your fork's branch to `closedloop-ai/closedloop-electron:main`
3. Include a description of what changed and why
4. Address review feedback with additional commits (don't force-push during review)
5. A maintainer will squash merge to `main` after approval

## Code Style

- **TypeScript** throughout — strict mode enabled
- **ESLint** for linting (`just desktop-lint`)
- **Node.js built-in test runner** for tests (`just desktop-test`)

## Testing

- Add tests for new functionality in `apps/desktop/test/`
- Tests use Node.js built-in test runner (`node:test`)
- Run the full suite before submitting: `just desktop-test`

## Commit Messages

Follow the format in `.gitmessage`:

```
<TICKET>: <description>

- bullet point details

Testing: what was tested
Risks: what could break
```

For external contributors without a ticket, use `CONTRIB:` as the prefix.
