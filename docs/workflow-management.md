# Workflow management interfaces

The App and both terminal layouts expose local `/workflow` and `/deep-research` commands. They launch Apexo-owned workflows, never an external Grok process. The panel discovers built-in, project, and user sources; validates a source without executing it; and accepts JSON arguments, an agent budget, and concurrency. Deep Research provides a question field in the App.

Supported commands are `/workflow`, `/workflow list`, `/workflow runs`, `/workflow validate NAME`, `/workflow run NAME JSON`, and `/deep-research QUESTION`. The run command and a nonempty research shortcut launch once when the panel opens. Opening the dashboard alone does not execute a workflow. Terminal controls also provide source cycling, argument editing, and explicit launch.

Every UI launch uses the native Workflow launch bridge, including launches from legacy Sessions. The bridge creates a dedicated native host with a durable association to the originating Session. The UI supplies the currently selected model and agent when available. Discovery and related history use the originating Session ID; pause, resume, and stop use the returned host Session ID and workflow ID. Reload discovers linked hosts from durable backend state rather than browser memory.

Run cards show status, phase, agent usage, token usage, results, and child Sessions. Pausing and stopping target the selected run. Stop requires confirmation. Resume accepts a total agent budget, requiring an increase for a budget-limited run. Closing a panel leaves execution running. Backend process-restart limitations remain authoritative and are shown as errors rather than silently retrying work.

Only currently implemented execution options are exposed. Model selection comes from the existing composer; the management form adds budget and concurrency. Fork, worktree, schema-retry, and additional effort controls are not claimed by this UI checkpoint.

## Verification checkpoint

App and TUI package typechecks passed. Real mini and fullscreen PTYs each passed ten checks, including launch, host isolation, untouched main transcript, validation, budget resume, pause, confirmed stop, and Deep Research. Production bundled-browser and native Desktop each passed eleven checks, adding reload recovery without resubmission; both screenshots were visually inspected. The immediate pre-change isolated composer baseline is 110 ms median and 118 ms p95 after two warmups, recorded in the [side-question benchmark](testing/performance/side-question-composer-baseline.md). The final isolated Workflow sample measured 110.5 ms median and 120 ms p95, showing no meaningful observed regression; see the [measurement record](testing/performance/workflow-composer-baseline.md).

Observed issues are tracked in [BUG118](testing/ui/workflow-run-order.md), [BUG119](testing/test-fixtures/workflow-browser-scroll-selector.md), and [BUG120](testing/runtime/workflow-stop-paused.md). The native harness application-root correction is documented in [BUG122](testing/test-fixtures/workflow-native-app-path.md). Functional acceptance and the isolated post-change benchmark are complete.

## Localization

English and Simplified Chinese App copy uses shared translation keys. Workflow, run, concurrency, and cancellation terminology was checked against [GitHub's Chinese workflow documentation](https://docs.github.com/zh/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow) and [Microsoft's Chinese concurrent workflow documentation](https://learn.microsoft.com/zh-cn/agent-framework/workflows/orchestrations/concurrent). “智能体预算” and “深度研究” remain product-specific labels suitable for native-speaker review. JSON, source names, Session IDs, and Token are retained technical identifiers. Terminal copy follows the existing English interface convention.
