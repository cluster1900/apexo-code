# Antigravity native login

Apexo reuses the login owned by the Antigravity CLI (`agy`). Select **Antigravity** in the provider picker, then choose a model from that provider. Selecting a model also selects its provider and credential; an OpenAI API key is never sent to Antigravity.

If `agy` is already signed in, Apexo connects automatically. Otherwise, the desktop connection dialog opens a terminal running `agy`. Complete the native sign-in once; Apexo detects the saved login and closes the dialog. Closing the dialog cancels its terminal. The TUI asks you to run `agy` in a separate terminal on the server and reconnect after signing in.

Install the CLI using the [official installation instructions](https://www.antigravity.google/docs/cli/install/). Run `agy models` to check native access. When using a remote Apexo server, install and sign in on that server: the server's native session is the one being reused.

## Credential ownership

- macOS: the native `gemini` / `antigravity` Keychain entry, including the Go keyring encoding.
- Linux: the same native Secret Service entry, read with `secret-tool` (install your distribution's libsecret tools).
- Windows: the native `gemini:antigravity` generic credential, read through Windows Credential Manager.
- When the native keyring has no entry, Apexo reads agy's fallback file at `~/.gemini/antigravity-cli/antigravity-oauth-token`.

Apexo stores only an external credential reference. It rereads the native token before requests and asks `agy models` to refresh an expiring session. It does not run a second OAuth flow, copy refresh tokens into Apexo storage, or log credential values. Removing the Apexo connection does not sign out of `agy`; an existing native login can be detected again on the next startup. Disable the Antigravity provider in configuration to exclude it permanently.

## Current scope

Both the desktop's V1 runtime and V2 support streamed responses, tool calls and continuation using the native account. Available models and limits come from Antigravity's account-specific catalog, including tiered Gemini models. Gemini tiers expose low, medium and high reasoning variants in V2. Native account quotas still apply.

This reuses the login session, not existing agy conversation history or agy-specific tools, UI and extensions. Apexo retains its own conversation history, tools and permission checks. Native logout requires signing in again; quota and network failures do not trigger another OAuth flow.

Validated live on macOS with agy 1.3.3: Gemini streamed text via V1, and a tool-call/result/continuation round trip via V2. Claude was quota-limited in both Apexo and native agy during validation. Linux Secret Service and Windows Credential Manager paths require testing on their respective systems.

The design was compared with [pi](https://github.com/earendil-works/pi) and [OpenCode v2](https://github.com/anomalyco/opencode/tree/v2), using an external credential reference rather than independent OAuth credentials. Chinese login terminology follows [Microsoft](https://learn.microsoft.com/zh-cn/visualstudio/ide/signing-in-to-visual-studio) and [Mozilla](https://support.mozilla.org/zh-CN/kb/im-having-problems-with-my-account).
