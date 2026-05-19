# Implementation Plan: Desktop Onboarding Popup (PR #1087 frontend follow-up)

## Summary

PR #1087 (PLN-494) landed only backend scaffolding in `symphony-alpha`: 5 telemetry
categories in `desktopTelemetryEventSchema`, schema tests, and the `GET /onboarding`
endpoint returning `wizardCompleted: boolean`. No user-facing UI shipped.

This plan covers the actual frontend follow-up, which lives entirely in **this repo**
(`closedloop-electron`, `apps/desktop/`). It adds a standalone onboarding reminder
popup that nudges users who have set up the desktop app to return to the web app and
finish the web onboarding wizard. It wires the 5 telemetry events, an auto-suppress
check against `GET /onboarding`, and session-vs-permanent dismiss persistence.

> Supersedes the earlier version of this file, which was written in a workspace where
> `closedloop-electron` was assumed unavailable and therefore deferred all real work as
> MANUAL. Both repos are present; the desktop work is automatable here.

**Scope:**
- In-scope: popup UI in `apps/desktop/src/renderer/index.html`; main-process eligibility
  check + auto-suppress at boot; `GET /onboarding` client; 5 telemetry emissions; new
  persisted `onboardingPopupDismissedPermanent` setting; IPC + preload wiring; unit tests.
- Out-of-scope: any change to `symphony-alpha` (schema, endpoint, and schema/endpoint
  tests already shipped in #1087). The desktop `TelemetryCategory` union must add the 5
  category strings, but the cloud `desktopTelemetryEventSchema` already accepts them.

## Acceptance Criteria

| ID | Criterion | Source |
|----|-----------|--------|
| AC-001 | Popup renders on first eligible desktop launch (desktop setup complete, web wizard not complete, not permanently dismissed) | PRD Acceptance |
| AC-002 | On launch the desktop calls `GET /onboarding` with the desktop API key and reads `wizardCompleted` | PRD FR6 |
| AC-003 | All 5 telemetry events emit at the correct lifecycle points and validate against `desktopTelemetryEventSchema` | PRD Acceptance |
| AC-004 | Auto-suppress: when `wizardCompleted === true`, no popup shows and `onboarding.popup_suppressed_auto` is emitted exactly once | PRD Acceptance, FR6 |
| AC-005 | Session dismiss reappears on next relaunch; permanent dismiss does not | PRD Acceptance |

## Architecture Fit

The desktop app is an Electron app with a single `BrowserWindow`. Key anchors:

- **Renderer**: `apps/desktop/src/renderer/index.html` — one file, inline CSS + inline
  `<script>` (no separate bundled renderer entry). Main→renderer messaging is done by
  re-broadcasting IPC messages as `CustomEvent`s in `preload.ts` (see the existing
  `desktop:onboarding-state-changed` listener at `preload.ts:135-137`). The popup is a
  CSS overlay in this file, shown/hidden by a new `desktop:show-onboarding-popup` event.
- **Preload bridge**: `apps/desktop/src/main/preload.ts` exposes `desktopApi.*` via
  `contextBridge`. Existing onboarding methods at `preload.ts:55-59`.
- **Main process**: `apps/desktop/src/main/app.ts` — `boot()` (~`app.ts:507-624`) sets
  `bootReadyForOnboarding = true` at `app.ts:526`. IPC handlers register in
  `registerIpcHandlers()` (`app.ts:2191+`). `getOnboardingState()` (~`app.ts:1846`) and
  `isDesktopSetupComplete()` (~`app.ts:871-877`) already encapsulate desktop setup state.
- **Telemetry**: `Observability.emitTelemetry(severity, category, message, trace?,
  diagnostics?)` in `apps/desktop/src/main/observability.ts` → `TelemetryService.emit`
  → cloud relay (Socket.IO). Telemetry round-trips over the relay, **not** REST, so
  emission needs no API key. `TelemetryCategory` union lives in
  `apps/desktop/src/main/telemetry-protocol.ts:13-56` and must gain the 5 new strings.
- **API key + apiOrigin**: `this.apiKeyStore.getApiKey()` returns the `sk_` key;
  `this.settingsStore.getApiOrigin()` returns the REST API origin. The pattern for an
  authenticated REST call is a plain `fetch(new URL("/onboarding", apiOrigin), {...})`
  with `Authorization: Bearer ${apiKey}` (the endpoint uses `withAnyAuth`, which accepts
  a Bearer api_key). Existing unauthenticated REST calls: `app.ts:1290`, `app.ts:1332`.
- **Persistence**: `electron-store` via `SettingsStore` (`settings-store.ts`), typed by
  `DesktopSettings` / `DEFAULT_DESKTOP_SETTINGS` in `apps/desktop/src/shared/contracts.ts:109-150`.

Impacted files:
- `apps/desktop/src/shared/contracts.ts` — add `onboardingPopupDismissedPermanent` to
  `DesktopSettings` + `DEFAULT_DESKTOP_SETTINGS`.
- `apps/desktop/src/main/settings-store.ts` — getter/setter for the new flag; honor it in `update()`.
- `apps/desktop/src/main/telemetry-protocol.ts` — 5 new `TelemetryCategory` strings.
- `apps/desktop/src/main/observability.ts` — 5 emit helper methods.
- `apps/desktop/src/main/onboarding-popup.ts` *(new)* — eligibility + auto-suppress logic,
  `GET /onboarding` client, pure and unit-testable.
- `apps/desktop/src/main/app.ts` — call the popup controller in `boot()`; register
  `desktop:dismiss-onboarding-popup` / `desktop:onboarding-popup-cta` IPC handlers.
- `apps/desktop/src/main/preload.ts` — expose `dismissOnboardingPopup` /
  `onboardingPopupCta`; re-broadcast `desktop:show-onboarding-popup`.
- `apps/desktop/src/renderer/index.html` — popup markup, CSS, inline-script wiring.
- `apps/desktop/package.json` — version bump (required by `apps/desktop/CLAUDE.md`).
- `apps/desktop/test/onboarding-popup.test.ts` *(new)* — unit tests.

## Architecture Decisions

| Decision | Options | Chosen | Rationale |
|----------|---------|--------|-----------|
| Popup surface | Separate `BrowserWindow` vs in-renderer CSS overlay | In-renderer CSS overlay in `index.html` | App is single-window; matches existing renderer patterns; no new window lifecycle |
| Permanent-dismiss storage | `DesktopSettings` (global) vs `SavedConfig` (per-profile) | `DesktopSettings.onboardingPopupDismissedPermanent` | Per GAP-002 answer: "use settings-store, where onboardingCompleted is saved." Simpler standalone popup, not profile-scoped |
| Session-dismiss storage | Persisted flag vs renderer in-memory | Renderer in-memory only | "Session" = not persisted by definition; reappears next launch (AC-005) |
| Auto-suppress "emit once" | Separate counter vs reuse permanent flag | On `wizardCompleted === true`, emit `onboarding.popup_suppressed_auto` then set `onboardingPopupDismissedPermanent = true` | Wizard completion is terminal; setting the flag makes future launches skip the check entirely and guarantees single emission (AC-004) |
| Eligibility gate | Show always vs gate on desktop setup complete | Gate on `isDesktopSetupComplete()` (onboarding done + sandbox + API key) | Popup's purpose is reminding *set-up* desktop users to finish the *web* wizard; without an API key the `GET /onboarding` call cannot authenticate anyway |
| Auto-suppress logic location | Inline in `app.ts` vs new `onboarding-popup.ts` module | New `onboarding-popup.ts` with injected `fetchImpl` | `app.ts` is already large; a pure module with injected fetch mirrors `managed-onboarding.ts` and is unit-testable |
| Telemetry transport | REST vs relay | Relay (existing `Observability.emitTelemetry`) | Desktop telemetry already flows over the Socket.IO relay; no new transport needed |

## Tasks

### Phase 1: Persistence + contracts

- [ ] **T-1.1**: Add `onboardingPopupDismissedPermanent: boolean` to the `DesktopSettings`
  interface and `DEFAULT_DESKTOP_SETTINGS` (`false`) in `apps/desktop/src/shared/contracts.ts`
  *(AC-005)*
- [ ] **T-1.2**: Add `getOnboardingPopupDismissedPermanent()` / `setOnboardingPopupDismissedPermanent()`
  to `SettingsStore`, and handle the key in `SettingsStore.update()` (boolean guard, matching
  the existing `onboardingCompleted` pattern) *(AC-005)*

### Phase 2: Telemetry plumbing

- [ ] **T-2.1**: Add the 5 category strings to the `TelemetryCategory` union in
  `apps/desktop/src/main/telemetry-protocol.ts`: `onboarding.popup_shown`,
  `onboarding.popup_cta_clicked`, `onboarding.popup_dismissed_session`,
  `onboarding.popup_dismissed_permanent`, `onboarding.popup_suppressed_auto` (exact
  strings already accepted by `desktopTelemetryEventSchema` in #1087) *(AC-003)*
- [ ] **T-2.2**: Add 5 emit helpers to `Observability` (severity `"info"`) that delegate
  to `Observability.emitTelemetry`, mirroring existing per-event methods *(AC-003)*

### Phase 3: Eligibility + auto-suppress logic (`onboarding-popup.ts`)

- [ ] **T-3.1**: Create `apps/desktop/src/main/onboarding-popup.ts` with a
  `fetchOnboardingStatus({ apiOrigin, apiKey, fetchImpl? })` function that does a
  `GET /onboarding` with `Authorization: Bearer ${apiKey}`, validates the response with a
  Zod schema (`{ wizardCompleted: boolean }`, per repo convention — do not hand-roll
  `typeof` checks), and returns a discriminated result (`ok` / `failed` with reason:
  `request_failed` | `http_error` | `invalid_response`) *(AC-002)*
- [ ] **T-3.2**: In the same module, add `resolveOnboardingPopupDecision(deps)` — a pure
  function that takes `{ setupComplete, dismissedPermanent, statusResult }` and returns
  one of `"skip"` (setup incomplete or already permanently dismissed — no API call, no
  telemetry), `"suppress"` (`wizardCompleted === true`), or `"show"` (wizard incomplete,
  or status fetch failed — fail open so the reminder still shows) *(AC-001, AC-004)*

### Phase 4: Boot integration + IPC (`app.ts`, `preload.ts`)

- [ ] **T-4.1**: In `app.ts boot()`, after `bootReadyForOnboarding = true` (`app.ts:526`),
  call a new `maybeShowOnboardingPopup()` method (fire-and-forget, never throws): gate on
  `isDesktopSetupComplete()` and `!getOnboardingPopupDismissedPermanent()`; on `"suppress"`
  emit `onboarding.popup_suppressed_auto` and set `onboardingPopupDismissedPermanent = true`;
  on `"show"` send `desktop:show-onboarding-popup` to the renderer and emit
  `onboarding.popup_shown`; on `"skip"` do nothing *(AC-001, AC-002, AC-003, AC-004)*
- [ ] **T-4.2**: Register IPC handlers in `registerIpcHandlers()`:
  `desktop:dismiss-onboarding-popup` (payload `{ permanent: boolean }`) — on `permanent`,
  persist the flag and emit `onboarding.popup_dismissed_permanent`; otherwise emit
  `onboarding.popup_dismissed_session` (no persistence). `desktop:onboarding-popup-cta` —
  open `webAppOrigin` in the external browser and emit `onboarding.popup_cta_clicked`
  *(AC-003, AC-005)*
- [ ] **T-4.3**: In `preload.ts`, add `desktopApi.dismissOnboardingPopup(payload)` and
  `desktopApi.onboardingPopupCta()` invoke wrappers, and re-broadcast
  `desktop:show-onboarding-popup` as a `CustomEvent` (mirror `desktop:onboarding-state-changed`
  at `preload.ts:135-137`) *(AC-001)*

### Phase 5: Renderer UI (`index.html`)

- [ ] **T-5.1**: Add the popup overlay markup + CSS to `index.html` (hidden by default;
  reuse existing CSS custom properties / theme tokens). Content: short reminder copy +
  primary CTA ("Open ClosedLoop web app"), "Remind me later" (session dismiss), and
  "Don't show again" (permanent dismiss). No em dashes in copy. Ensure the dialog is
  accessible (`role="dialog"` + `aria-labelledby`/`aria-describedby`; do not pair
  `role="presentation"` with `aria-label`) *(AC-001)*
- [ ] **T-5.2**: Wire the inline renderer script: on `desktop:show-onboarding-popup` show
  the overlay; CTA button → `desktopApi.onboardingPopupCta()` then hide; "Remind me later"
  → `desktopApi.dismissOnboardingPopup({ permanent: false })` then hide; "Don't show again"
  → `desktopApi.dismissOnboardingPopup({ permanent: true })` then hide *(AC-001, AC-003, AC-005)*

### Phase 6: Tests + release

- [ ] **T-6.1**: Add `apps/desktop/test/onboarding-popup.test.ts` (`node:test`): cover
  `fetchOnboardingStatus` (success, http error, invalid body — with mock `fetchImpl`) and
  `resolveOnboardingPopupDecision` (`skip` / `suppress` / `show`, including fail-open on
  fetch failure) *(AC-002, AC-004)*
- [ ] **T-6.2**: Extend `apps/desktop/test/settings-migration.test.ts` (or add a focused
  settings-store test) asserting `onboardingPopupDismissedPermanent` round-trips and
  defaults to `false` for existing installs *(AC-005)*
- [ ] **T-6.3**: Bump `apps/desktop/package.json` `version` (patch) — required by
  `apps/desktop/CLAUDE.md` for any commit touching `apps/desktop/`

### Manual Verification

- [ ] **T-7.1** [MANUAL]: `just desktop-dev` with a desktop API key configured and an
  incomplete web wizard — confirm the popup renders on launch (AC-001), CTA opens the web
  app, "Remind me later" hides it and it reappears on relaunch, "Don't show again" hides
  it permanently (AC-005).
- [ ] **T-7.2** [MANUAL]: With a completed web wizard, confirm no popup shows and verify
  `onboarding.popup_suppressed_auto` appears once in the observability sink (AC-004).
- [ ] **T-7.3** [MANUAL]: Verify all 5 events round-trip desktop → relay → observability
  sink with `origin: Desktop` and the correct category strings (AC-003).

## API & Data Impacts

- **No `symphony-alpha` changes.** `GET /onboarding` and `desktopTelemetryEventSchema`
  already shipped in #1087. This repo only *consumes* them.
- **New persisted setting**: `onboardingPopupDismissedPermanent` in the `desktop-settings`
  electron-store. Per `closedloop-electron/CLAUDE.md`, persisted store schema changes that
  must survive downgrade need legacy handling — but this is purely additive: older app
  versions ignore the unknown key, and `SettingsStore.getOnboardingPopupDismissedPermanent`
  falls back to the `DEFAULT_DESKTOP_SETTINGS` value for installs that never wrote it. No
  migration block and no ClosedLoop ticket required.
- **Telemetry contract**: the 5 category strings are added to the desktop's local
  `TelemetryCategory` union only; the wire contract (`desktopTelemetryEventSchema`)
  already accepts them, so this is not a breaking change.

## Risks & Constraints

| Risk | Mitigation |
|------|------------|
| `GET /onboarding` is slow or unreachable at boot | Call is fire-and-forget off the boot path, wrapped in try/catch; on failure `resolveOnboardingPopupDecision` returns `"show"` (fail open) so the reminder still appears |
| Popup shows for users who never finished desktop setup | Eligibility gated on `isDesktopSetupComplete()` (onboarding + sandbox + API key) before any API call |
| `onboarding.popup_suppressed_auto` emitted on every launch | On suppress, set `onboardingPopupDismissedPermanent = true`; subsequent launches short-circuit before the API call |
| Desktop file change without version bump fails CI | T-6.3 bumps `apps/desktop/package.json` |
| Renderer is one 190KB `index.html` with inline script | Keep popup markup/CSS/script self-contained and clearly delimited; no build-step assumptions |

## Test Plan

- Unit (`node:test`): `fetchOnboardingStatus` + `resolveOnboardingPopupDecision` (T-6.1);
  `onboardingPopupDismissedPermanent` persistence (T-6.2). Run via `just desktop-test`.
- Lint/typecheck: `just desktop-lint`, `just desktop-typecheck`.
- Manual: T-7.1–T-7.3 cover the renderer UI, dismiss persistence across relaunch, and the
  end-to-end telemetry round-trip (no automated harness for the relay path).

## Rollback

All changes are additive and confined to `apps/desktop/`. Reverting the branch removes
the popup, the IPC handlers, the telemetry helpers, and the new setting; the unknown
persisted `onboardingPopupDismissedPermanent` key on disk is harmless to older builds.

## Open Questions (resolved)

- **OQ-1**: Resolved — the CTA dismisses the popup. T-5.2 hides the overlay after CTA.
  Treated as a session-level dismiss (no permanent flag set).
- **OQ-2**: Resolved — proceed with placeholder reminder copy; revise after implementation.

## Gaps (resolved)

- **GAP-002** (session vs permanent dismiss storage): Resolved — use `SettingsStore`
  (`DesktopSettings.onboardingPopupDismissedPermanent`), the same store as
  `onboardingCompleted`. Session dismiss is renderer in-memory only.
- **GAP-003** (mirror the 9-step web wizard vs standalone popup): Resolved — a simpler
  standalone popup. Its only job is reminding users to return to the web app once the
  desktop app is downloaded and set up.
