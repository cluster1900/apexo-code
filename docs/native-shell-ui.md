# Native background Shell in the Tasks manager

The existing App Tasks manager now combines native Task and Process receipts. Process rows retain `proc_` identities and use native Process list/output/wait/cancel endpoints; they are never represented as child Sessions. Compatibility servers retain the existing experimental Task routes. There is no legacy execution bridge.

The native manager requests up to 100 records from each domain and shows the newest 100 combined. A failure in one listing does not erase successful rows from the other domain, and the affected domain has an explicit localized availability message. Counts refer only to the displayed list. Output detail includes retained text, exit code, truncation notice and restart interruption guidance. Commands and process IDs remain data, not translated prose.

Users can read output, wait up to ten seconds, refresh, or stop a process. Closing the panel or changing selection cancels the owned HTTP wait, not the underlying command. These actions do not initiate model work. An accepted Stop of active model work suppresses later process completion messages; stopping the process itself remains an explicit action. Historical interrupted receipts are readable without automatic execution replay. This retains the documented native Stop policy rather than claiming that installed-reference parent cancellation has identical behavior.

## Verification scope

The implementation was verified in a coherent private source checkpoint containing the accepted Shell backend and privately generated clients. This private checkpoint preceded the shared acceptance below. No generated client files are part of this UI handoff.

- App adapter: 24 tests, 89 assertions with real HTTP, explicit throwing client defaults, domain-discriminated IDs, partial list failures, bounded wait payload and bodyless cancellation.
- App package typecheck: passed.
- Production browser: seven checks, 16 setup provider calls; passive reads and control actions added no calls.
- Actual rebuilt native window: seven checks, 16 setup provider calls, including en/zh/zht and a 640-pixel viewport.
- Compatibility browser: one combined regression check with five setup provider calls; actual Shell and subagent Task output/cancellation retained their compatibility routes.
- Dictionary audit: 19 additive values in each of en/zh/zht; all existing values unchanged, placeholder sets matched, and no new untranslated English-equal values.

The real fixture creates one subagent Task plus five Shell receipts covering running, completed, failed, truncated and restart-interrupted states. It injects only control/list failures needed to verify safe presentation; command execution, provider turns, receipts, output and cancellation use the real implementation. Native-only mode rejects legacy health and records route usage. Screenshots cover English, Simplified Chinese and Traditional Chinese, plus a narrow viewport. The truncation screenshot explicitly reveals and checks the warning's viewport/hit geometry; finding it in the DOM alone is not visual evidence.

The initial native fixture inherited Bun's ten-second listener idle timeout, colliding with the deliberate ten-second wait. Its server log explicitly reported that timeout and the request ended 499. The owned listener now disables transport idle expiry while the UI keeps a bounded wait and client deadline. This is a fixture transport correction, not a production Process retry; see [BUG-20261015-146](testing/test-fixtures/process-ui-listener-idle-timeout.md).

## Limits

Monitor rows and a native terminal Process manager are not implemented by this App slice. Other locale dictionaries use fallback English for the 19 new keys. [Localization notes](native-shell-ui-localization.md) document the source review limits. [BUG-20261015-142](testing/ui/process-sdk-error-policy.md) records the actual SDK error-policy defect and corrected verification. Installed Shell reference evidence belongs to the backend feature notes; the App UI is Apexo-owned and does not claim pixel parity with the reference.

## Shared window acceptance

The twelve owned UI files are integrated after exact baseline/proposal hash checks. The shared App adapter passed 24 tests / 89 assertions, all 21 workspace typechecks passed, and App/Desktop production builds both completed. The rebuilt App index matches the privately accepted artifact exactly. Shared production browser and actual Desktop window each passed seven checks / 16 setup provider calls; all UI reads, waits and controls added zero provider calls. The compatibility browser passed its combined regression with five setup calls and no additional UI work.

Shared screenshots were inspected for Simplified Chinese restart guidance, Traditional Chinese truncation and output, English retained-output notice, and the 480-pixel browser / 640-pixel native layouts. Actual output remained reachable without horizontal overflow. All owned UI commands exited zero and were reaped. The paired fixed-backend composer measurement is complete: after 115.5 ms median / 127 ms p95 versus before 110.5/126, with zero Long Task entries. These small samples do not establish a causal timing change; see [the measurement record](testing/performance/native-shell-ui-composer.md). This acceptance does not close Monitor or terminal Process management.
