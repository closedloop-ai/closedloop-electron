# Flaky Test Quarantine

Tests in this directory are known-flaky and run as a **non-blocking** gate on every PR.
They do not block merge, but their output is posted to the PR check summary so the team
retains signal on fixes in progress.

## How to quarantine a test

1. `git mv apps/desktop/test/<name>.test.ts apps/desktop/test/quarantine/<name>.test.ts`
2. Add a `// FLAKY: <link to issue or brief reason>` comment near the top of the file.
3. Open or link a follow-up issue to fix or delete the test.

## How to un-quarantine

Move the file back to `apps/desktop/test/`. If the test has been fixed and passes for
several PRs running in the quarantine job, it is eligible to return to the main gate.

## Policy

- Quarantined tests are reviewed on a rolling basis -- long-standing quarantines should
  be fixed or deleted, not left indefinitely.
- Deleting a flaky test without a quarantine period loses signal; prefer quarantine first.
