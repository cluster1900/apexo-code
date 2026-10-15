/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { ApexoKeymapProvider } from "@apexo/tui/keymap"
import { WorkflowBrowser, type WorkflowActions } from "@apexo/tui/component/workflow-browser"

test.each([19, 26])("Workflow list growth preserves visible header rows at height %i", async (height) => {
  const actions: WorkflowActions = {
    list: async () =>
      Array.from({ length: 12 }, (_, index) => ({
        id: `workflow_${index}`,
        sessionID: "ses_workflow_layout",
        name: `layout-${index}`,
        status: "paused",
        agentBudget: 1,
        agentsSpent: 1,
        concurrency: 1,
        tokens: 120,
        usageIncomplete: true,
        resumeBlockedReason: "schema_attempt_claimed",
        createdAt: 1,
        updatedAt: 1,
        children: [],
      })),
    sources: async () => [{ name: "deep-research", scope: "builtin" }],
    validate: async () => ({ name: "deep-research", valid: true, diagnostics: [] }),
    launch: async () => {
      throw new Error("No launch expected")
    },
    pause: async () => {
      throw new Error("No pause expected")
    },
    resume: async () => {
      throw new Error("No resume expected")
    },
    stop: async () => {
      throw new Error("No stop expected")
    },
  }
  function Harness() {
    const keymap = createDefaultOpenTuiKeymap(useRenderer())
    return (
      <ApexoKeymapProvider keymap={keymap}>
        <WorkflowBrowser
          actions={actions}
          onClose={() => {}}
          height={height}
          theme={() => ({ text: "white", muted: "gray", error: "red", highlight: "cyan" })}
        />
      </ApexoKeymapProvider>
    )
  }
  const app = await testRender(() => <Harness />, { width: 120, height: height + 6 })
  try {
    await app.renderOnce()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Workflows · separate child sessions; closing keeps runs active")
    expect(frame).toContain("Source: builtin:deep-research · Tab selects source")
    expect(frame).toContain("Budget 16 · Concurrency 4")
    expect(frame).toContain("This structured-output attempt cannot resume.")
    expect(frame).toContain("↑↓ select · p pause · x stop")
  } finally {
    app.renderer.destroy()
  }
})
