# Computer Use catalog install automation

## BUG-20261118-001

The fullscreen TUI fixture waited for the Computer Use row to appear and sent `i`. The multi-plugin Apexo Skills catalog had cn-tender-review selected by default. The terminal confirmed that cn-tender-review became enabled while Computer Use remained available.

To reproduce the fixture failure, open `/plugins` against the Apexo Skills catalog with both entries available and submit Install without selecting Computer Use. The fixture should select the intended row, confirm trust, apply the package, and verify the pinned installed revision. Filter for `computer-use` and observe its selection marker and idle state before submitting Install.

The rerun passed four fullscreen checks with the real Git catalog package. It fetched the pinned revision, activated the MCP service, and persisted the completed `desktop_version` tool result.

## BUG-20261118-002

The Web Client fixture clicked the first `.plugins-card` as soon as a card existed. The browser reported that a covering element occupied its click point. The fixture should click the unique Computer Use card after search and layout have settled.

To reproduce the fixture failure, open the Plugins tab, filter for `computer-use`, and attempt the card click during the panel transition. The revised runner waits for one matching heading, positions the card in the viewport, and checks the element at its center before clicking. The exact source of the initial covering element was not established.

The Web Client rerun passed four checks against the real native backend. It installed the public pinned Git package directly, activated it, and rendered a completed tool result. The packaged V2 Desktop passed the same checks plus ownership of its compiled CLI backend.
