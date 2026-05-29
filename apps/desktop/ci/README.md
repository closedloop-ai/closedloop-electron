# Desktop CI workflow staging

## `audit-gate.yml` — UI Numbers Audit Gate (FEA-1437 Phase 6)

This is the Phase 6 CI gate for the UI Numbers Audit. It lives here, **not** in
`.github/workflows/`, only because the automation token that opened this PR
lacks the GitHub `workflow` OAuth scope (pushing a file under
`.github/workflows/` is rejected without it).

**To activate** (one step, needs a token/UI with `workflow` scope):

```bash
git mv apps/desktop/ci/audit-gate.yml .github/workflows/audit-gate.yml
git commit -m "ci: activate UI Numbers Audit gate"
```

Until moved, the gate does not run automatically, but every check it performs is
runnable locally and is identical to the existing `test:audit` suite:

```bash
pnpm -C apps/desktop audit:coverage   # static coverage gate (fast, no build)
pnpm -C apps/desktop test:audit       # full node-side audit
pnpm -C apps/desktop test:audit:ui    # headless Playwright tile audit
```

The workflow has two jobs:

- **coverage** — runs `audit:coverage`: regenerates the tile scan + coverage
  classification, asserts every scanner detection is classified (no
  `needs_review`), asserts every harness parser has a `*-parser.contract.test.mjs`,
  and posts the `by_status` breakdown to the job summary. This is the merge gate
  that fires when a new route / tile / parser lands without manifest coverage.
- **ui-audit** — builds the agent-monitor sidecar and runs the headless
  Playwright tile audits (rendered DOM == oracle).

Real-Electron and visual-regression suites are intentionally excluded (they run
elsewhere as non-blocking, flaky-by-nature per PLN-760).
