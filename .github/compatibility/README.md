# Compatibility Tracking

## `last-known-good.json`

Tracks the last verified-compatible pair of SHAs between `closedloop-electron` and `symphony-alpha`.

### Fields

- **`symphonyAlpha.sha`** — The commit SHA of `symphony-alpha` that was part of the last verified compatible pair.
- **`symphonyAlpha.repo`** — The `org/repo` path used by workflow checkout steps.
- **`closedloopElectron.sha`** — The commit SHA of this repository that was tested against the above `symphonyAlpha` SHA.
- **`lastUpdated`** — ISO-8601 timestamp of when this file was last updated.
- **`updatedBy`** — Either `"manual"` or the GitHub username of the person who made the update.

### How it works

The `compatibility-smoke.yml` workflow runs on every PR. When a PR touches boundary-affecting paths (`apps/desktop/src/server/**`, `apps/desktop/src/shared/**`, and select `apps/desktop/src/main/` protocol files), the workflow checks out `symphony-alpha` at the last-known-good SHA, installs its dependencies, and runs its compatibility test suite with `ELECTRON_CHECKOUT_PATH` pointing at this repository's PR branch. If tests fail, the PR is blocked from merging.

### Coordinated changes

When making a coordinated boundary change across both repos, apply the `compatibility-pair` label to the symphony-alpha PR. The workflow will detect the labeled PR and test against its head SHA instead of last-known-good.

**Race condition caveat:** both PRs must have the `compatibility-pair` label applied before either CI run starts. If labels are applied sequentially, one run may miss the paired PR and test against last-known-good instead.

### Manual updates

1. Update `symphonyAlpha.sha` to the desired commit SHA from `symphony-alpha`.
2. Update `closedloopElectron.sha` to the commit SHA from this repository that was verified compatible.
3. Set `lastUpdated` to the current ISO-8601 timestamp.
4. Change `updatedBy` to your GitHub username.
5. Open a PR with the change for review.
