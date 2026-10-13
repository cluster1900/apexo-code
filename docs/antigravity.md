# Antigravity native login

Apexo reuses the login owned by the Antigravity CLI (`agy`). Select **Antigravity** in the provider picker, then choose a model from that provider. Selecting a model also selects its provider and credential; an OpenAI API key is never sent to Antigravity.

If `agy` is already signed in, Apexo connects automatically. Otherwise, choose Antigravity to start the native sign-in. In the desktop app this opens an embedded terminal. In the local TUI (`bun dev`), Apexo temporarily hands the terminal to `agy`, which opens the Google sign-in page in the default browser. Complete sign-in once; Apexo detects the saved login and returns to model selection automatically. Cancelling the native login returns to Apexo. When attached to a remote server, the TUI asks you to run `agy` on that server; it never signs in to a different account on the local client.

GitHub authentication is unrelated to Antigravity login. `gh auth login` is only a contributor command for opening a GitHub pull request; it is not needed to run Apexo or use Antigravity.

Install the CLI using the [official installation instructions](https://www.antigravity.google/docs/cli/install/). Run `agy models` to check native access. When using a remote Apexo server, install and sign in on that server: the server's native session is the one being reused.

## Credential ownership

- macOS: the native `gemini` / `antigravity` Keychain entry, including the Go keyring encoding.
- Linux: the same native Secret Service entry, read with `secret-tool` (install your distribution's libsecret tools).
- Windows: the native `gemini:antigravity` generic credential, read through Windows Credential Manager.
- When the native keyring has no entry, Apexo reads agy's fallback file at `~/.gemini/antigravity-cli/antigravity-oauth-token`.

Apexo stores only an external credential reference. It rereads the native token before requests and asks `agy models` to refresh an expiring session. It does not run a second OAuth flow, copy refresh tokens into Apexo storage, or log credential values. Removing the Apexo connection does not sign out of `agy`; an existing native login can be detected again on the next startup. Disable the Antigravity provider in configuration to exclude it permanently.

## Model and reasoning selection

Choose the model once (for example, **Claude Sonnet 5.5**), then select **Low**, **Medium**, or **High** in the reasoning selector. The CLI uses the same selection with `--model antigravity/claude-sonnet-5-5 --variant low`. Only the available native tiers are listed; models with a single tier do not gain extra unsupported choices.

Apexo maps fixed tiers to the corresponding native model ID. Gemini tiered models use the native thinking-level parameter when a separate model ID is unavailable. **Default** follows the first model entry for that family in the native catalog, without adding an unconditional High override. Previously saved suffixed model IDs remain callable, but are hidden from the model picker; their default keeps the original native ID.

## Current scope

Both the desktop's V1 runtime and V2 support streamed responses, tool calls and continuation using the native account. Available models and limits come from Antigravity's account-specific catalog, including tiered Gemini models. Both runtimes share the same model grouping and reasoning tiers. Native account quotas still apply.

This reuses the login session, not existing agy conversation history or agy-specific tools, UI and extensions. Apexo retains its own conversation history, tools and permission checks. Native logout requires signing in again; quota and network failures do not trigger another OAuth flow.

Validated live on macOS with agy 1.3.3: Gemini streamed text via V1, and a tool-call/result/continuation round trip via V2. Claude was quota-limited in both Apexo and native agy during validation. Linux Secret Service and Windows Credential Manager paths require testing on their respective systems.

The [2026-10-13 validation record](antigravity-validation.md) additionally covers real CLI, interactive TUI, Electron desktop, and native agy file-editing tasks with same-conversation continuation. It records the remaining quota-error difference and the limits of first-time authorization coverage.

The design was compared with [pi](https://github.com/earendil-works/pi) and [OpenCode v2](https://github.com/anomalyco/opencode/tree/v2), using an external credential reference rather than independent OAuth credentials. Chinese login terminology follows [Microsoft](https://learn.microsoft.com/zh-cn/visualstudio/ide/signing-in-to-visual-studio) and [Mozilla](https://support.mozilla.org/zh-CN/kb/im-having-problems-with-my-account).
