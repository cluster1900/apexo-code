# Slash commands with arguments and V2 layout parity in Desktop

Grok Build 1.0.61/1.0.62 parity defects in the Desktop web and Electron application (`packages/app`, `packages/desktop`,
`packages/session-ui`, `packages/ui`). Shared parsing and matching helpers come from `@apexo/sdk/v2/grok-commands`
(`parseSlashInput`, `sessionMatches`, `resolveSessionReference`, `parseCopyArgs`, `sideQuestionText`).

## BUG-20261018-421: Registered Desktop slash commands typed with arguments were sent to the model

- **Category**: UI
- **Affected scope**: `packages/app/src/context/command.tsx`, `packages/app/src/components/prompt-input/slash-route.ts`,
  `packages/app/src/components/prompt-input/submit.ts`, `packages/app/src/components/prompt-input.tsx`,
  `packages/app/src/components/prompt-input-v2.tsx`, `packages/app/src/components/grok-commands.tsx`,
  `packages/app/src/components/agent-dashboard.tsx`.
- **Occurrences**: 1 confirmed defect (root cause of most items below).
- **Observed**: typing a registered built-in slash command with arguments or a trailing space (`/rename New title`,
  `/copy 2`, `/resume bug-triage-notes`, `/themes ignored words`, `/usage `) closed the inline slash menu without
  selecting an item and submitted the text as an ordinary prompt to the model.
- **Expected**: registered built-in slash commands run locally; commands with `onSlash(args)` receive the argument
  string, while commands without an argument handler execute `onSelect("slash")` and ignore trailing arguments. Server
  commands (`sync().data.command`) keep their existing dispatch.
- **Reproduction**: open a session in the Desktop app, type `/rename New title` and press Enter; a user message is
  created and sent to the provider.
- **Root cause**: `CommandOption` had no argument callback channel (`onSlash`), and `handleSubmit` only checked four
  hardcoded names in `grok.submit` before falling through to prompt submission.
- **Fix**: added `onSlash?: (args: string) => void`, `findSlashOption`, `runSlashOption`, and `command.slash(name, args)`
  in `packages/app/src/context/command.tsx`; added `registeredSlash` in
  `packages/app/src/components/prompt-input/slash-route.ts`; wired `onCommandSlash: command.slash` into both
  `PromptInput` and `PromptInputV2`; and added argument handlers for `/rename <title>`, `/resume <id-or-title>`,
  `/copy [N] [path]`, and `/model <name> [effort]`.
- **Verification**: unit tests in `packages/app/src/components/prompt-input/slash-route.test.ts` and
  `packages/app/src/utils/model-args.test.ts`; browser checks `rename-with-title-sets-title`,
  `command-without-arg-handler-ignores-args`, `trailing-space-runs-command`, `model-with-name-switches-model`,
  `model-unknown-name-toasts` in `packages/apexo/script/grok-slash-args-ui.mjs` with zero provider turns.

## BUG-20261018-422: `/copy` copied the entire transcript instead of the Nth latest assistant response

- **Category**: UI
- **Affected scope**: `packages/app/src/utils/session-export.ts`, `packages/app/src/pages/session/use-session-commands.tsx`.
- **Occurrences**: 1 confirmed defect.
- **Observed**: `/copy` copied the full formatted session transcript and ignored `/copy N`.
- **Expected** (Grok Build `04-slash-commands.md`): `/copy` copies the latest assistant response's markdown, `/copy N`
  copies the Nth-latest turn's response, and `/copy [N] <path>` shows a clear notice that file output is terminal-only.
- **Root cause**: `session.copy` called `copyTranscript` instead of extracting per-turn assistant responses.
- **Fix**: added `sessionResponse(data, index)` in `packages/app/src/utils/session-export.ts` and updated `session.copy`
  in `packages/app/src/pages/session/use-session-commands.tsx` to use `parseCopyArgs` and `sessionResponse`.
- **Verification**: unit tests in `packages/app/src/utils/session-export.test.ts`; browser checks `copy-latest-response`,
  `copy-nth-response`, `copy-missing-response-toasts`, and `copy-path-is-terminal-only`.

## BUG-20261018-423: `/agents`, `/config-agents`, and `/personas` silently cycled the active agent

- **Category**: UI
- **Affected scope**: `packages/app/src/pages/session/use-composer-commands.tsx`.
- **Occurrences**: 1 confirmed defect.
- **Observed**: `/agents`, `/config-agents`, and `/personas` were registered as `slashAliases` on `agent.cycle`,
  switching the active agent immediately without opening a picker.
- **Expected**: `/agents` (and aliases `/config-agents`, `/personas`) opens an agent picker dialog and leaves the active
  agent unchanged when dismissed with Escape.
- **Root cause**: `use-composer-commands.tsx` attached `slashAliases: ["agents", "config-agents", "personas"]` to
  `agent.cycle`.
- **Fix**: registered a separate `agent.choose` command (`slash: "agents"`, `slashAliases: ["config-agents", "personas"]`)
  that opens `DialogGrokList` with available primary agents and only calls `local.agent.set(...)` on selection.
- **Verification**: browser checks `agents-opens-picker-without-switching`, `agents-escape-keeps-build`, and
  `agents-pick-switches-to-plan`.

## BUG-20261018-424: `/resume`, `/session-info` (`/status`, `/info`), and global slash commands were missing or misrouted in V2 layout

- **Category**: UI
- **Affected scope**: `packages/app/src/components/dialog-resume-session.tsx`,
  `packages/app/src/components/dialog-session-info.tsx`, `packages/app/src/components/grok-commands.tsx`,
  `packages/app/src/components/settings-dialog.tsx`, `packages/app/src/components/status-popover.tsx`,
  `packages/app/src/pages/layout.tsx`, `packages/app/src/pages/layout-new.tsx`.
- **Occurrences**: 1 confirmed defect.
- **Observed**:
  1. `/resume` in `layout.tsx` only toggled the sidebar instead of opening a session picker or resolving `/resume <query>`.
  2. `/session-info`, `/status`, and `/info` in `status-popover.tsx` opened the server health popover, and because
     `defaultSettings.general.showStatus` is `false`, `StatusPopoverV2` was not mounted by default so those slash
     commands were not registered at all.
  3. In the default V2 layout (`NewLayout` in `layout-new.tsx`), `LegacyLayout` (`layout.tsx`) is not mounted, and
     `useSettingsCommand` (`settings-dialog.tsx`) omitted `slash`/`slashAliases` on `settings.open` and `plugins.open`
     and omitted `theme.cycle` (`/themes`, `/theme`, `/t`), `session.toggle.timestamps` (`/timestamps`),
     `reasoning.toggle` (`/thinking`), `provider.connect` (`/connect`, `/login`), and `app.exit` (`/exit`, `/quit`).
- **Expected**: `/resume` opens `DialogResumeSession` filtered by `sessionMatches` or navigates directly when
  `resolveSessionReference` finds a single match; `/session-info` (`/status`, `/info`) opens `DialogSessionInfo` with
  auth, model, agent, turn count, context usage, and `c`/`y` copy shortcuts; and global slash commands work in both V2
  and legacy layouts.
- **Fix**: implemented `DialogResumeSession` and `DialogSessionInfo`; registered `sessions.open` (`/resume`, `/continue`)
  and `session.info` (`/session-info`, `/status`, `/info`) in `useGrokCommands`; registered the global slash commands in
  `useSettingsCommand`; and restored `apexo.timestamps` on mount in `NewLayout`.
- **Verification**: browser checks `session-info-shows-session-details`, `status-alias-opens-session-info`,
  `resume-picker-filters-by-words`, `resume-ambiguous-query-prefills-picker`, `resume-exact-title-opens-session`,
  `resume-exact-id-opens-session`, and `command-without-arg-handler-ignores-args` (`/themes ignored words`).

## BUG-20261018-425: Mid-message `/btw` was sent to the main session turn

- **Category**: UI
- **Affected scope**: `packages/app/src/components/prompt-input/slash-route.ts`,
  `packages/app/src/components/prompt-input/submit.ts`.
- **Occurrences**: 1 confirmed defect.
- **Observed**: typing `fix the retry loop first. /btw what does SIDE_MARKER stand for?` sent the message to the main
  session turn because `submit.ts` only matched a leading `/btw`.
- **Expected**: `/btw` anywhere in a normal-mode message extracts the whole message minus the `/btw` token as a side
  question via `sideQuestionText` and sends nothing to the main turn.
- **Fix**: added `sideQuestion(text)` in `slash-route.ts` wrapping `sideQuestionText(text)` and routed `handleSubmit`
  through it before session/prompt submission.
- **Verification**: unit tests in `slash-route.test.ts`; browser check `mid-message-btw-is-side-question`.

## BUG-20261018-426: `/quit` and `/exit` did not quit the Electron app on macOS

- **Category**: UI
- **Affected scope**: `packages/app/src/desktop-menu.ts`, `packages/desktop/src/main/desktop-menu-actions.ts`,
  `packages/app/src/pages/layout.tsx`, `packages/app/src/components/settings-dialog.tsx`.
- **Occurrences**: 1 confirmed defect.
- **Observed**: `app.exit` called `window.close()`, which closes the window on macOS without quitting the Electron
  application because `window-all-closed` keeps the process alive on `darwin`.
- **Expected**: `/quit` and `/exit` quit the application in Electron while falling back to `window.close()` in a browser.
- **Fix**: added `"app.quit"` to `DesktopMenuAction` (`packages/app/src/desktop-menu.ts`), handled it with `app.quit()` in
  `packages/desktop/src/main/desktop-menu-actions.ts`, and called `platform.runDesktopMenuAction("app.quit")` when
  available.
- **Verification**: `bun typecheck` in `packages/app` and `packages/desktop`.

## BUG-20261018-427: Short exact slash aliases could be outranked by fuzzy matches, and selecting a dialog slash command lost focus

- **Category**: UI
- **Affected scope**: `packages/ui/src/hooks/use-filtered-list.tsx`, `packages/app/src/components/prompt-input.tsx`,
  `packages/session-ui/src/v2/components/prompt-input/interaction.ts`.
- **Occurrences**: 1 confirmed defect.
- **Observed**:
  1. `useFilteredList` ordered results purely by fuzzysort score across `["trigger", "aliases", "title"]`, so a short
     exact alias query could rank behind a fuzzy title/trigger match.
  2. Selecting a dialog-opening command from `PromptInputV2`'s inline slash popover queued
     `requestAnimationFrame(() => editor?.focus())`, stealing focus back from the newly opened dialog's search input.
- **Expected**: exact slash or alias matches are pinned first in the filtered list, and `focus.editor` does not steal
  focus when a dialog is open.
- **Fix**: added an optional `exact?: (item: T, query: string) => boolean` predicate to `useFilteredList` that partitions
  exact matches ahead of non-exact matches, wired it in `PromptInput` and `PromptInputV2`, and guarded `focus.editor`
  in `interaction.ts` when a dialog is active.
- **Verification**: browser checks `exact-alias-first` (`/m` → `model.choose`, `/t` → `theme.cycle`,
  `/ml` → `grok.multiline`, `/mem` → `session.memory`) and `agents-pick-switches-to-plan` in
  `packages/apexo/script/grok-slash-args-ui.mjs`.
