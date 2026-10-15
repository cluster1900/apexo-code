# BUG-20261015-227: Scheduler action filtering lost contextual callback types

- Status: Fixed in the private Scheduler UI draft; shared integration pending.
- Scope: Fullscreen Scheduler actions and related native prompt admission typing. One new UI authoring episode, not a recurrence claim.
- Observed: `packages/tui` typecheck reported eight TS7006 diagnostics on action callbacks after an inline action array was filtered. It separately reported TS18048 on direct access to optional `input.prompt.text`. The Apexo package check found an existing footer test's required action stub missing the newly added `changeSchedule` method.
- Expected: Each action uses the component's real option contract; absent prompt input remains valid; typed test adapters implement their declared interface.
- Cause: Calling `.filter` on the literal removed contextual typing from the JSX `actions` prop. The prompt read was unguarded, not a deferred-callback narrowing failure. The footer test stub was not extended with the new method.
- Fix: Constrain the array with `satisfies DialogSelectProps<string>["actions"]` before filtering; use an optional-safe prompt read; make unrelated footer fixtures explicitly reject schedule operations.
- Verification: `bun typecheck` from `packages/tui`, `packages/app`, and `packages/apexo` passed in the private checkpoint. Terminal adapter/transport checks passed 38 tests and 152 assertions. No `any`, cast-away contract, or public API change was added.
