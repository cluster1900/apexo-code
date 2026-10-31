# Issue #185 — Artifact Workspace for Documents, Spreadsheets, Presentations and PDFs

**Status:** development design and implementation audit
**Priority:** P2
**Scope:** durable artifact manifests, preview, generation, validation and Desktop/CLI artifact workspace

## 1. Problem

Apexo can already attach media and tool artifacts to Session results, and plan/goal features persist file-backed artifacts. It does not yet have a format-aware artifact workspace for PDF, DOCX, XLSX/CSV and PPTX. Users need to inspect generated files, compare revisions, validate them, and feed a selected artifact or page/range/slide back into the same Session without exposing arbitrary file contents.

The artifact workspace must be an Apexo-owned layer over existing files and tools. A format library may parse/render a file, but it cannot bypass Location, permission, redaction or Session event rules.

## 2. Current state

### Implemented

- Browser and Computer artifacts have typed IDs, metadata and replay events in [`packages/schema/src/browser.ts`](../../../packages/schema/src/browser.ts) and [`packages/schema/src/computer.ts`](../../../packages/schema/src/computer.ts).
- Media tools and attachment conversion exist in [`packages/core/src/tool/media.ts`](../../../packages/core/src/tool/media.ts), [`packages/app/src/utils/media-read.ts`](../../../packages/app/src/utils/media-read.ts) and [`packages/session-ui/src/components/file-media.tsx`](../../../packages/session-ui/src/components/file-media.tsx).
- Plan and goal artifacts are persisted with path/hash metadata in [`packages/core/src/session/plan-receipt.ts`](../../../packages/core/src/session/plan-receipt.ts) and [`packages/core/src/session/plan.ts`](../../../packages/core/src/session/plan.ts).
- The workflow build script already stages artifacts in [`packages/workflow-script/script/artifact.ts`](../../../packages/workflow-script/script/artifact.ts).
- Existing media E2E coverage is under [`packages/apexo/test/e2e/v2-media.e2e.test.ts`](../../../packages/apexo/test/e2e/v2-media.e2e.test.ts).

### Partial or missing

- There is no common `ArtifactManifest` for format, revision, source, sensitivity, preview pages, extracted text and validation status.
- PDF/document/spreadsheet/presentation rendering and generation are not first-class Core services.
- Desktop has no artifact browser with preview, diff, download, pin, comment anchor or “attach to prompt” flow.
- Artifact references are often paths or inline data; path-only references are fragile after worktree changes and can leak private content.
- Retention, size limits, cleanup, virus scanning, macro handling and redaction policies are undefined.

## 3. Target model

```text
ArtifactManifest
  id, projectID, sessionID?, runID?, locationID
  pathRef, contentHash, mediaType, format, size, createdAt
  source: tool | generated | git | browser | upload
  sensitivity: normal | private | secret_possible | blocked
  revision, parentID?
  previewStatus, validationStatus

ArtifactPreview
  artifactID, kind: thumbnail | page | sheet | slide | text | diff
  locator: page | sheet/range | slide | section
  contentRef, rendererVersion, generatedAt, expiresAt

ArtifactOperation
  id, artifactID, action: inspect | render | convert | generate | validate | export
  status: queued | running | succeeded | failed | cancelled
  inputHash, outputArtifactID?, error?, cursor
```

The manifest is immutable for a content hash. A new file revision creates a new manifest linked by `parentID`; metadata labels may be updated through an idempotent operation. Preview artifacts are disposable and never become the canonical source.

## 4. Format-specific contracts

- **PDF:** page count, text extraction, page image preview, metadata, password/encryption detection, no silent decryption.
- **DOCX/Markdown:** structural outline, paragraphs, tables, images, tracked-change policy, sanitized HTML/Markdown preview.
- **XLSX/CSV:** workbook/sheet names, dimensions, typed cell preview, formula/value distinction, bounded range reads, formula recalculation policy and CSV encoding detection.
- **PPTX:** slide count, slide text/notes, image preview and slide-level diff; reject external relationship traversal unless explicitly allowed.

All parsers must be bounded by bytes, pages, cells, rows, slides and CPU time. Generated output must be validated by reopening it with the same or an independent parser before it is reported as complete.

## 5. API and UI

Add a public artifact group to Protocol/Server with list/get, preview, inspect, validate, convert, diff, attach, export and delete/retire endpoints. Every response includes artifact ID, content hash, sensitivity, operation status and cursor. Do not return large binary data inline; use a short-lived artifact download/read endpoint with Location authorization.

Desktop should provide an Artifact Workspace panel with project/session filters, format badges, preview pane, metadata, revision history, validation errors, pin/comment/attach actions and a safe download action. CLI should expose `artifact list`, `artifact inspect`, `artifact preview`, `artifact validate` and `artifact attach`; output must be bounded and machine-readable with `--json`.

A prompt attachment stores an artifact reference plus selected locator (page, range, slide or section) and a sanitized text/preview summary. It does not copy the entire binary into Session history.

## 6. Security and lifecycle

1. Resolve paths through Location; reject symlink escapes and paths outside the project/worktree policy.
2. Detect secrets and personal data in extracted text before indexing or including it in events.
3. Mark uploads, screenshots and generated files with source and sensitivity; never infer “safe” from extension alone.
4. Treat macros, embedded scripts, external links and formulas as untrusted. Preview in a sandbox and never execute macros.
5. Enforce per-operation byte/time/concurrency budgets and cancellation.
6. Retain manifests and audit events longer than previews; provide project retention and cleanup policies.
7. External export/share requires explicit approval and records destination, artifact hash and actor.

## 7. Implementation phases

### Phase 0 — Common manifest and storage

1. Add schemas, IDs, content hashing and ArtifactStore interface.
2. Adapt browser/computer/media/plan artifacts into the manifest.
3. Add list/get/retire API and migration for existing path artifacts.

### Phase 1 — Read/preview

1. Implement PDF and text/document inspection with bounded parsers.
2. Add spreadsheet range and presentation slide previews.
3. Store previews as derived artifacts with renderer version.
4. Add Desktop/CLI read-only workspace.

### Phase 2 — Validation and comparison

1. Add format validators and structured errors.
2. Add artifact revision graph and format-aware diff.
3. Add prompt attachment locators and event references.

### Phase 3 — Generation/export

1. Add generation adapters behind BackgroundJob and permission policies.
2. Validate outputs and publish a manifest only after successful reopen.
3. Add safe export/download and retention cleanup.

## 8. Test matrix and acceptance criteria

- Manifest migration from browser/computer/media/path artifacts.
- Large, malformed, encrypted, macro-enabled and truncated files.
- PDF page preview, DOCX structure, XLSX formulas/ranges, PPTX slide rendering.
- Hash/revision immutability and concurrent generation idempotency.
- Cancellation, timeout, process crash and restart recovery for BackgroundJobs.
- Location escape, symlink, secret redaction, macro and external-link safety.
- Desktop preview/attach/comment and CLI bounded output.
- Generated output reopens, validates and is downloadable by authorized users only.

Definition of done: a user can find a generated artifact, inspect a bounded preview, compare revisions, attach a page/range/slide to the same Session, validate a new output and recover a failed operation without losing the canonical file or exposing secrets.

## 9. Dependencies and risks

- Depends on #177 for BackgroundJob, operation state and event cursors.
- Depends on #179 for the Desktop artifact panel and review queue.
- Browser/Computer artifacts from #178 should adopt this manifest rather than inventing another store.
- Format libraries differ by platform and license; keep adapters replaceable and run parser versions in metadata.
