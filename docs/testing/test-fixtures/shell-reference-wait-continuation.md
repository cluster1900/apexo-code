# Shell reference wait counted a normal continuation as an automatic reminder

- **Bug ID:** BUG-20261015-114
- **Scope:** Isolated installed Shell lifecycle acceptance fixture.
- **Status:** Fixture corrected and verified.
- **Independent occurrences:** One authoring episode.

The blocking-output scenario expected zero automatic completion reminders but counted every tools-enabled provider request after releasing the command. Its one request was the normal continuation after the blocking tool result: the last message had role `tool`, and the latest user input remained the original wrapped query. The captured request did not contain a background completion reminder. The assertion failed `1 !== 0` after the real Shell and blocking wait completed. This is a fixture classification error, not a product or installed-runtime failure.

The fixture now distinguishes automatic completion requests by the installed runtime's actual latest-user `system-reminder` input. It retains the total provider request count separately. The idle cancel case is also reported explicitly as a no-op, rather than treating it as an accepted Stop of an active provider turn.

Reproduce from `packages/apexo` with pinned Bun: `bun script/grok-native-shell-official.mjs wait`. The corrected command must retain the ordinary post-tool continuation while asserting zero separate completion reminders. All installed processes and local fixture servers must be reaped.

Corrected targeted run passed: installed1.0.52 made12 total requests, one normal post-wait continuation and zero automatic reminder turns. The real command and installed ACP child exited; the local provider server was closed. No product change was needed.
