# BUG-20261028-001: V2 empty session message sync and FileTree directory listing fell back to legacy V1 endpoints

- **Status:** Fixed and verified in Playwright against the V2 native server.
- **Scope:** `packages/app/src/context/server-session.ts` (`fetchMessages`) and `packages/app/src/context/file.tsx` (`tree.list`).
- **Independent occurrences:** 1 (discovered while enabling `showFileTree` by default and verifying active V2 sessions in Playwright).

## Observed vs Expected Behavior

- **Observed:**
  1. Navigating to a newly created V2 session before the first prompt was promoted into a message caused `fetchMessages` to receive `data: []` from `GET /api/session/:id/message` (`source.length === 0`), fall through to legacy `GET /session/:id/message?limit=20`, and fail with `404 Not Found` on the V2 server.
  2. Opening the right-side File Tree panel (`#file-tree-panel`) in `All files` mode called `sdk().client.file.list` (`GET /file?path=...`), which returned `404 Not Found` on the V2 server and left the File Tree empty.
- **Expected:**
  1. An empty V2 session (`source.length === 0 && !before`) should tolerate a `404` or empty result from the legacy `client.session.messages` fallback and return the empty normalized V2 message page.
  2. `FileProvider` `tree.list` should use `serverSDK().api.file.list` (`GET /api/fs/list` on V2, with V1 compatibility via `createV1Api`) and normalize returned entries into `FileNode` records.

## Reproduction Steps

1. Start the V2 daemon (`bun run --cwd packages/cli dev -- serve --register`) and the App dev server (`bun run --cwd packages/app dev`).
2. Create a new session from the V2 New Session page and open the right-side File Tree panel (`All files` tab).
3. Observe `GET /session/:id/message?limit=20 -> 404 Not Found` and an empty File Tree before the fix.

## Root Cause

- `fetchMessages` in `packages/app/src/context/server-session.ts` only returned early from the V2 `messageApi.list` branch when `source.length > 0 || before`, so an empty V2 session fell through to `client.session.messages` without catching `404` errors on pure V2 servers.
- `packages/app/src/context/file.tsx` had migrated `search` to `serverSDK().api.file.find`, but `tree.list` still called legacy `sdk().client.file.list`.

## Fix

- Updated `fetchMessages` in `packages/app/src/context/server-session.ts` to catch errors from the legacy `client.session.messages` fallback when `source.length === 0 && !before` and return the empty V2 `currentPage`.
- Updated `tree.list` in `packages/app/src/context/file.tsx` to call `serverSDK().api.file.list({ location: { directory: sdk().directory }, path: dir || undefined })` and map entries to `FileNode` objects.

## Verification

- `bun run --cwd packages/app typecheck` passed.
- Playwright E2E verification against the live V2 server confirmed that newly created sessions render without `404` errors and `#file-tree-panel` (`All files`) populates the repository entries cleanly.
