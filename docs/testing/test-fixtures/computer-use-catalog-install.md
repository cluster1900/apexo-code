# Computer Use catalog install automation

## BUG-20261118-001

The fullscreen TUI fixture waited for the Computer Use row to appear and sent `i`. The multi-plugin Apexo Skills catalog had cn-tender-review selected by default. The terminal confirmed that cn-tender-review became enabled while Computer Use remained available.

To reproduce the fixture failure, open `/plugins` against the Apexo Skills catalog with both entries available and submit Install without selecting Computer Use. The fixture should select the intended row, confirm trust, apply the package, and verify the pinned installed revision. Filter for `computer-use` and observe its selection marker and idle state before submitting Install.

The rerun passed four fullscreen checks with the real Git catalog package. It fetched the pinned revision, activated the MCP service, and persisted the completed `desktop_version` tool result.

## BUG-20261118-002

The Web Client fixture clicked the first `.plugins-card` as soon as a card existed. The browser reported that a covering element occupied its click point. The fixture should click the unique Computer Use card after search and layout have settled.

To reproduce the fixture failure, open the Plugins tab, filter for `computer-use`, and attempt the card click during the panel transition. The revised runner waits for one matching heading, positions the card in the viewport, and checks the element at its center before clicking. The exact source of the initial covering element was not established.

The Web Client rerun passed four checks against the real native backend. It installed the public pinned Git package directly, activated it, and rendered a completed tool result. The packaged V2 Desktop passed the same checks plus ownership of its compiled CLI backend.

## BUG-20261118-005 — Mini TUI acceptance left the prompt in the editor

- Scope is the Computer Use terminal acceptance driver. The Mini TUI rendered the version request as a draft, and the provider recorded zero requests. The driver expected Enter to submit one turn.
- Run `bun script/computer-use-tui.mjs` from `packages/apexo` with an assembled bundle and the earlier driver that writes the prompt and carriage return together.
- The old driver sent Enter in the same PTY write as the entire prompt. The exact input event that the terminal parser produced was not captured. The revised driver writes a bracketed paste, waits for the complete draft in the editor, and sends Enter once as a separate event.
- The mini and `--fullscreen` runs each passed the three attachment, tool history, and rendered completion checks. Native history recorded the completed `desktop_version` output with version `1.3.1`.

## BUG-20261118-006 — The browser test proxy forwarded stale compression headers

- Scope is the disposable Web Client compatibility harness. The browser showed an empty Plugins catalog with a fetch error although the proxied `GET /plugins` returned HTTP 200.
- Serve the built Web Client over a Bun proxy that fetches the mixed CLI's gzip response and forwards the response unchanged. The same-origin browser should decode the JSON and display the catalog.
- Bun fetch decoded the upstream body while its response still carried `Content-Encoding: gzip`. The proxy removed the upstream encoding and length headers before forwarding the decoded stream.
- The Web Client then passed all five compatibility UI checks, including download, apply, MCP toggle, and tool completion in the original Session. The response header trace confirmed that the tested catalog response used gzip.
