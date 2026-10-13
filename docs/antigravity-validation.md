# Antigravity validation — 2026-10-13

## Result

Existing native agy authentication and a two-turn Gemini file-editing task passed in the Apexo CLI, the interactive TUI, the Electron desktop app, and native agy on macOS. This verifies the basic integration; it does not establish full feature parity with agy.

The tested checkout was `antigravity-session`, including the uncommitted native TUI login changes. Runtime versions were Bun 1.3.14, Electron 42.3.3, and agy 1.3.3. The Electron main process, renderer, and Node sidecar were built from this checkout.

## Live test

Each entry point operated on its own temporary directory containing `input.txt` with `ALPHA=37` and `BETA=5`.

1. Read the input through a tool, create `answer.txt` containing `total=42\n`, and return a success marker.
2. Continue the same conversation, read the generated file, change it to `total=43\n`, and return a second success marker.

| Entry point                          | Model                                 | First turn                            | Same-conversation continuation                           | Final file   |
| ------------------------------------ | ------------------------------------- | ------------------------------------- | -------------------------------------------------------- | ------------ |
| `apexo run`                          | `antigravity/gemini-3.8-flash-tiered` | Read/write tools and `E2E_OK`         | Read/edit tools and `E2E_CONTINUE_OK`                    | `total=43\n` |
| `bun dev` interactive TUI            | `antigravity/gemini-3.8-flash-tiered` | Read/write tools and `TUI_E2E_OK`     | Read/edit tools and `TUI_CONTINUE_OK`                    | `total=43\n` |
| Electron desktop, default V1 sidecar | `antigravity/gemini-3.8-flash-tiered` | Read/write tools and visible `E2E_OK` | Read/edit tools and visible `E2E_CONTINUE_OK`            | `total=43\n` |
| Native `agy --print`                 | `gemini-3.8-flash-low`                | Native tools and `E2E_OK`             | Same conversation ID, native tools and `E2E_CONTINUE_OK` | `total=43\n` |

These are the same Gemini Flash family, but Apexo's default tiered model and agy's explicit low variant are not an assertion of identical reasoning settings. All four paths reused the existing agy login without another authorization prompt. Apexo's isolated CLI auth file contained only `{ "type": "external", "method": 0 }` for Antigravity.

The desktop test used the actual Electron app and its Node sidecar, with isolated onboarding data. An automation-only launcher selected an unused debugging port and allowed background rendering; provider, authentication, model, and tool code were unchanged. The normal development launcher hardcodes port 9222, which was already occupied on this machine. The desktop requested permission for the temporary directory outside its default project; the test approved that specific directory. Both successful replies and tool activity were verified in the renderer, and file contents were verified independently.

The TUI ran in a real terminal PTY. Its completed replies were additionally verified in the isolated session database. An initial Bun/node-pty automation harness produced no terminal output and timed out, so that harness was not counted as a passing test.

## Confirmed difference

Claude Sonnet (`claude-sonnet-5-5-low`) did not produce a response. Native agy reported that the AI credit balance was too low. Apexo received HTTP 429, retried, then returned a generic Antigravity account error. Neither path requested another login.

Consequently, quota exhaustion messaging and retry behavior are not yet unified. This test does not establish successful Claude inference through Apexo.

## Automated authentication checks

The focused native-provider and TUI-login suites were rerun: **16 passed, 0 failed**. They cover existing-login reuse, missing login, native credential rereading, refresh, credential-reference persistence, authentication versus quota errors, stream/tool metadata, native command launch, cancellation, child cleanup, and restoring the terminal.

The preceding regression run also passed: 3,458 unit tests, 21 typecheck tasks, client generation verification, and 206 HTTP cases in each of coverage/auth/effect modes. These counts describe automated coverage, not complete manual coverage of every entry point.

## Not covered

- A real first-time Google authorization from a signed-out account. The current native account was not signed out; missing-login behavior was checked with isolated fixtures.
- Linux Secret Service and Windows Credential Manager on their respective operating systems.
- Every model, reasoning variant, image input, long-running request, and network recovery scenario.
- agy conversation import, agy-specific tools, extensions, or identical UI behavior; these are outside the current integration's scope.

## Reasoning selector follow-up — 2026-10-13

The model picker now groups native Low/Medium/High IDs into one model, with the reasoning selector choosing the actual native tier. The shared grouping is used by V1 and V2. Legacy IDs remain callable but are hidden from new selections. Default preserves the family's first native catalog entry (or the original ID for a legacy selection), without an added High override.

- **665 focused regression tests passed** across native Antigravity, provider configuration/status/transforms, and Grok V2 compatibility. The new cases execute the V1 Google SDK against a local HTTP server and prepare V2 requests through the real catalog plugin and model resolver. They check native IDs, thinking parameters, defaults, partial tier availability, tiered Gemini fallback, unsupported choices, and legacy aliases. The 13-case native suite passed again after the display-name fallback adjustment.
- Typechecks passed in Core, Apexo, App, and TUI. The Node sidecar and Electron app built successfully.
- An isolated Electron instance displayed one entry each for Claude Opus and Sonnet. Selecting Sonnet and Low showed the unsuffixed model name and a checked Low option. Screenshot: `/tmp/apexo-agy-variants-desktop-low.png`.
- Live CLI requests using `antigravity/gemini-3.8-flash` with `--variant low` and `--variant high` returned `VARIANT_LOW_OK` and `VARIANT_HIGH_OK`, respectively. Logs: `/tmp/apexo-agy-variant-live-2a251slw/low.jsonl` and `high.jsonl`.
- Claude inference was not retried; its native request mapping was verified locally. The quota and platform limitations above still apply.

Temporary live-test artifacts for this run are under `/tmp/apexo-agy-e2e.V6qlg1`; the desktop result screenshot is `/tmp/apexo-agy-e2e-desktop-final.png`. Those temporary paths are local evidence, not required runtime files.
