# Slash commands with arguments in the terminal UIs

Grok Build 1.0.61/1.0.62 parity defects in the fullscreen TUI (`packages/tui`) and minimal mode
(`packages/apexo/src/cli/cmd/run/footer*`). Shared parsing comes from `@apexo/sdk/v2/grok-commands`
(`parseSlashInput`, `sessionMatches`, `resolveSessionReference`, `parseCopyArgs`, `sideQuestionText`).

> IDs 401–405 for 2026-10-18 were already taken by other records, so this record uses 411–417.

## BUG-20261018-411: Built-in slash commands typed with arguments were sent to the model

- **Category**: UI
- **Affected scope**: `packages/tui/src/component/grok-commands.tsx`, `packages/tui/src/component/prompt/index.tsx`,
  new `packages/tui/src/prompt/slash-guard.ts`.
- **Occurrences**: 1 confirmed defect (root cause of most items below).
- **Observed**: typing a built-in with arguments or a trailing space (`/rename Better title`, `/copy 2`,
  `/resume login fix`, `/timestamps please`) submitted the text as an ordinary prompt; the model answered it.
  Only `/effort`, `/context-window`, `/docs` and `/plan` had argument handlers. The autocomplete only runs a
  built-in when its highlighted row is selected, and it hides as soon as the text contains a space.
- **Expected**: built-ins run locally; arguments are honored where Grok defines them; a built-in without an
  argument handler still runs (or explains itself) and never reaches the model. Server commands (config commands,
  MCP prompts, skills) keep their route.
- **Reproduction**: open a session in `apexo`, type `/rename Better title`, press Enter → a new model turn appears.
- **Root cause**: `submitInner` only consulted `grok.submit` (four names) before building a prompt draft;
  `deliverPrompt` routes only server commands, so every other `/name args` became prompt text.
- **Fix**: argument handlers for `/resume|/continue <id or title>`, `/rename|/title <title>`, `/copy [N] [path]`,
  `/model|/models|/m|/mo <name> [effort]`, `/feedback <message>` (saves a local draft) and `/export <file>`
  (new file only). Then `builtinSlashTarget` runs any palette built-in typed by name or alias (arguments ignored,
  with a toast saying so) unless a server command has that name or a later `submitInner` branch handles it
  (`/goal`, `/workflow`, `/deep-research`, `/btw`, native Memory, bare `/feedback`/`/hooks`). Session-only
  built-ins typed on the home screen get "Open a session first".
- **Verification**: see the shared section below (`builtin-without-handler-runs-locally`, `rename-with-argument`,
  `model-with-argument`, `feedback-with-argument`, `export-*`, `resume-*`, each with zero new provider requests
  and zero new session messages).

## BUG-20261018-412: `/copy` copied the whole transcript and `/doctor` named a missing backup

- **Category**: UI
- **Affected scope**: `packages/tui/src/routes/session/index.tsx`, `packages/tui/src/component/grok-commands.tsx`,
  new `packages/tui/src/util/slash-args.ts`.
- **Observed**: `/copy` was bound to "Copy session transcript". `/copy 2` and `/copy out.md` went to the model
  (BUG-411). `/doctor` over SSH claimed "/copy also writes a backup file", which did not exist.
- **Expected** (Grok `04-slash-commands.md`): `/copy` copies the latest response's source markdown, `/copy N` the
  Nth latest, `/copy [N] <path>` writes a new file and refuses (leaving it unchanged) when the name is taken; every
  copy also writes a backup file.
- **Root cause**: the TUI kept the upstream transcript-copy command under the `/copy` slash name.
- **Fix**: new `grok.copy` palette command and `/copy` argument handler using `turnResponses` (per user turn, the
  last assistant message with text) and `copyResponse` (`parseCopyArgs`, `wx` file creation, backup at
  `$APEXO_COPY_FILE` or `<Global data dir>/last-copy.txt`). "Copy session transcript" stays a palette entry (and
  vim `Y`). `/doctor` names the real backup path.
- **Verification**: unit tests in `test/cli/tui/slash-args.test.ts`; PTY checks `copy-nth-response-to-new-file`,
  `copy-refuses-existing-file`, `copy-backup-file` in both modes.

## BUG-20261018-413: Mid-message `/btw` was sent to the main turn

- **Category**: UI
- **Affected scope**: `packages/tui/src/component/prompt/index.tsx`, `packages/apexo/src/cli/cmd/run/footer.view.tsx`.
- **Observed**: `fix the parser first. /btw what is Y?` was submitted as a normal prompt in both fullscreen and
  minimal mode; only a leading `/btw` opened the side question.
- **Expected**: the whole message minus the `/btw` token becomes the side question; nothing goes to the main turn.
- **Root cause**: both surfaces matched `^/btw` only.
- **Fix**: use `sideQuestionText` (bare `/btw` still opens the empty side-question panel).
- **Verification**: PTY check `mid-message-btw-is-side-question` in both modes: the side-question API records
  `fix the parser first. what is BTW_SIDE?`, the main transcript keeps 4 messages and none contains the text.

## BUG-20261018-414: Resume picker filtered by plain title substring

- **Category**: UI
- **Affected scope**: `packages/tui/src/component/dialog-session-list.tsx`, `packages/tui/src/ui/dialog-select.tsx`.
- **Observed**: typing `login fix` found nothing for "Fix login bug"; ID prefixes never matched. Server search
  results also replaced the recent list, so client-side matching could not add word-order hits.
- **Expected** (1.0.61): every typed word, any order, any separators; or an ID prefix.
- **Fix**: filter with `sessionMatches` over the union of server search hits and the recent list; order by recency
  while filtering. `DialogSelect` gained an initial `filter` prop so `/resume <text>` opens the picker pre-filtered.
- **Verification**: PTY check `resume-picker-every-word-filter` (`/resume login fix` shows "Fix login bug", not
  "Unrelated work").

## BUG-20261018-415: `/resume <exact title>` looked ambiguous because of duplicate candidates

- **Category**: UI
- **Affected scope**: `packages/tui/src/component/grok-commands.tsx` (new `/resume` handler).
- **Occurrences**: 1, found by the first PTY run of the new handler (not a pre-existing defect).
- **Observed**: `/resume Fix login bug` opened the picker instead of the session; the PTY run timed out at
  "left the original session".
- **Root cause**: candidates concatenated the server list and the synced session list, so the same session appeared
  twice and `resolveSessionReference` treated the exact title as two matches.
- **Fix**: deduplicate candidates by ID before resolving.
- **Verification**: rerun passes `resume-exact-title-opens-session` (renaming after the resume renames the
  "Fix login bug" session, whose transcript stays empty).

## BUG-20261018-416: Enter on an argument-less server command left `/name ` in the composer

- **Category**: UI
- **Affected scope**: `packages/tui/src/component/prompt/autocomplete.tsx`, `packages/tui/src/component/prompt/index.tsx`.
- **Observed**: selecting any server command inserted `/name ` and waited for another Enter.
- **Expected** (1.0.62): a command whose arguments are optional runs on Enter.
- **Fix**: commands whose template has no argument placeholders (`hints` empty) run immediately via a new
  `onSubmit` prop. Commands with placeholders keep the trailing space because `hints` cannot distinguish optional
  from required arguments (native catalog commands all carry a hint). **Partial**: commands such as `/review` whose
  `$ARGUMENTS` is optional still insert `/review `.
- **Verification**: `bun typecheck` in `packages/tui`; not driven in the PTY script (the fixture exposes no
  argument-less server command).

## BUG-20261018-417: Minimal mode sent fullscreen built-ins to the model

- **Category**: UI
- **Affected scope**: `packages/apexo/src/cli/cmd/run/footer.view.tsx`, `footer.ts`, new `footer.slash.ts`.
- **Observed**: `/resume`, `/compact`, `/fork`, `/rewind`, `/copy`, `/export`, `/rename`, `/delete`, `/effort`,
  `/context-window`, `/always-approve`, `/auto`, `/usage`, `/plan`, `/history`, `/session-info`, `/context` typed in
  the `--mini` footer became prompt text.
- **Expected**: run what minimal mode can; otherwise a one-line notice like Grok's.
- **Fix**: `minimalSlash` classifies the text when it is not a known server/footer command: `/copy [N] [path]`
  (the footer records committed user/assistant text and reuses `copyResponse`), `/model [name]`,
  `/effort|/variants [level]`, `/skills`, `/help`, `/clear|/home|/welcome` (as `/new`) run locally; other
  fullscreen built-ins show `/<name> isn't available in minimal mode. Run /fullscreen to switch this session.`
- **Verification**: `test/cli/run/footer.slash.test.ts`; PTY check `minimal-builtin-notice` plus the shared copy and
  `/btw` checks in minimal mode.

## Shared verification

Run from `packages/apexo` unless noted:

```sh
bun test test/cli/tui/slash-args.test.ts test/cli/run/footer.slash.test.ts test/cli/run/footer.view.test.tsx
bun typecheck                 # packages/apexo
bun typecheck                 # packages/tui
bun script/grok-slash-args-tui.mjs --fullscreen
bun script/grok-slash-args-tui.mjs
```

Results: focused unit tests 45 pass / 0 fail (11 new helper tests, 3 new minimal tests); the broader
`bun test test/cli/tui test/tui test/cli/run` run passes 324 / 0 fail across 42 files; both typechecks pass; the
fullscreen PTY passes 12 checks (twice, after the BUG-415 fix); the minimal PTY passes 5 checks
(`copy-nth-response-to-new-file`, `copy-refuses-existing-file`, `copy-backup-file`,
`mid-message-btw-is-side-question`, `minimal-builtin-notice`). Every slash step asserts that the fake provider got no
new main-turn request and the session gained no message. The only provider requests are the two seeding prompts and
the side question. Plain `/copy` to the system clipboard was not driven in the PTY, so the developer's real clipboard
is never overwritten. That path is covered by unit tests with an injected writer.
