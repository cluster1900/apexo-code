# Issue 186 — Desktop Platform: Voice, Pop-out Windows, Updates, and Windows Sandbox

## Status and engineering finding

The Electron host and renderer already provide the main Desktop shell, onboarding, i18n, window controls, and a web-compatible App surface. Issue 186 is platform hardening, not a Core/Protocol feature. Start from [`packages/desktop/src/main`](../../../packages/desktop/src/main), [`packages/desktop/src/renderer`](../../../packages/desktop/src/renderer), preload/IPC boundaries, and [`packages/app`](../../../packages/app). Keep platform behavior behind Desktop capability adapters.

## Scope

- Voice input/output capability detection and permission-aware composer integration.
- Pop-out/floating windows with stable bounds, ownership, and close/reopen behavior.
- Signed auto-update service with staged rollout, verification, rollback, and interrupted-update recovery.
- Windows sandbox capability mapping and explicit unsupported states.

Do not move platform code into Core/Protocol or make cloud execution a prerequisite.

## Capability model

```text
DesktopCapabilities
  platform / arch / appVersion
  microphone: unavailable | permission_required | ready
  audioOutput: unavailable | ready
  popout: supported | unavailable
  updater: unsupported | checking | available | downloading | ready | failed
  sandbox: unsupported | restricted | ready | degraded
```

Capabilities are queried at startup and persisted only as diagnostics. The renderer must not infer support from platform strings alone.

## Voice flow

1. Renderer requests capability and current OS permission state.
2. User explicitly starts recording; no background microphone capture.
3. Preload forwards an allowlisted IPC request to the host.
4. Host obtains microphone permission and streams bounded audio frames to the composer adapter.
5. Stop, timeout, app backgrounding, permission denial, and device removal close the stream idempotently.
6. Transcription results are associated with the active composer/session but are not silently submitted.
7. Audio is not persisted unless the user explicitly saves it; diagnostics contain device/error metadata only.

Voice tests must use a fake device and a denied-permission path; do not require a developer's microphone in CI.

## Pop-out window lifecycle

A pop-out is a separate BrowserWindow owned by one Project/Session route. Persist window ID, route, display, bounds, zoom, and last focus. On reopen validate the display and clamp bounds. Close is idempotent and must remove stale ownership. Renderer state rehydrates from the public app store; it must not create duplicate windows on repeated events.

All IPC channels are allowlisted and typed. No arbitrary renderer-provided URL, filesystem path, or command may cross the preload boundary.

## Updater lifecycle

```text
idle -> checking -> available -> downloading -> ready_to_install
available/downloading -> failed
ready_to_install -> installing -> restarted | rolled_back
```

Require signed artifacts, pinned update metadata, HTTPS, checksum/signature verification, atomic staging, disk-space check, and rollback after a failed restart. Never replace a running binary in place. Display release/version, source, size, signature result, and restart action. Offline mode remains usable with the current version.

## Windows sandbox

Define a capability adapter that reports filesystem roots, process/network restrictions, shell availability, credential store, symlink behavior, and unsupported features. Apply the same Location and Permission semantics as macOS/Linux. If a capability cannot be enforced, mark it degraded and block operations that require the missing guarantee; never advertise a sandbox that is only cosmetic.

## Persistence and recovery

Platform state must be versioned and migration-safe. Interrupted updates recover to the last verified version. Pop-out state survives app restart but not a deleted Project. Voice sessions terminate on crash and cannot resume from stale audio handles. Store no secrets or raw audio in ordinary app state.

## API and testing

Most work stays in `packages/desktop` host/preload and `packages/app` adapters. Add typed capability IPC only where needed; do not add server endpoints for local window/microphone state. Use platform-specific fixtures and a capability matrix.

Acceptance:

- voice permission granted/denied/device removed/timeout paths are visible and idempotent;
- pop-out open/reopen/close, multi-display bounds, crash recovery, and duplicate-open races pass;
- update signature failure, interrupted download, restart failure, rollback, and offline startup pass;
- Windows sandbox capability and degraded-state tests block unsafe operations;
- Desktop Playwright tests exercise visible UI and state transitions, while host integration tests use fake OS adapters;
- no renderer can invoke an unallowlisted IPC channel or path.

## Delivery phases

1. Typed capability probe and preload allowlist.
2. Pop-out lifecycle and persisted bounds.
3. Voice adapter and permission UX.
4. Signed updater with rollback fixture.
5. Windows capability/sandbox adapter.
6. Cross-platform packaging and upgrade regression suite.

Dependencies: #179 for run-aware pop-outs and notifications, #189 for diagnostics, and existing Desktop packaging/signing infrastructure. Main risk is treating host-specific APIs as universally available; every feature must have explicit `unsupported` and `permission_required` states.
