# BUG-20261015-093: Fullscreen Home did not register the sandbox command

- Scope: draft terminal command-sandbox UI.
- Observed: a real fullscreen CLI attached without a Session showed `No matching items` for `/sandbox`. Enter left the command in the composer and never opened the passive panel.
- Expected: `/sandbox` opens passive status on Home as well as an existing Session, without creating a Session or invoking a provider.
- Root cause: registration was scoped to the Session route. The fallback submit interceptor ran after the autocomplete-visible guard, so it could not handle the Home command.
- Fix: register the command in the shared Prompt command list using its existing slash-command mechanism. Remove duplicate Session-route registration and the ineffective submit interceptor. The action lazily loads the existing stable-box dialog.
- Verification: from `packages/apexo`, `bun script/grok-sandbox-terminal-route.mjs --fullscreen --new` passes three checks: command open, no additional Session/provider work, and refresh/close/reopen. The mini counterpart also passes three checks. Both use the real CLI and PTY. Fullscreen Home retains no Session; mini attach's existing bootstrap creates one before the command, and the fixture compares counts after readiness rather than incorrectly attributing that bootstrap creation to `/sandbox`.
- No shipped-product recurrence is claimed. The initial mini overlay resolution failure is separately recorded in [BUG053](../test-fixtures/hooks-preference-private-workspace.md).
