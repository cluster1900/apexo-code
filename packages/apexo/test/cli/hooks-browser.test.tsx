/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { ApexoKeymapProvider } from "@apexo/tui/keymap"
import { HooksBrowser, type HooksActions } from "@apexo/tui/component/hooks-browser"

test.each([22, 30])("Hook list growth preserves visible controls at height %i", async (height) => {
  const actions: HooksActions = {
    get: async () => ({
      captured: true,
      generation: 1,
      inspection: {
        projectTrusted: true,
        diagnostics: [],
        hooks: Array.from({ length: 12 }, (_, index) => ({
          id: `hook_${index.toString(16).padStart(64, "0")}`,
          name: `layout-${index}`,
          event: "Notification",
          source: "global",
          type: "command",
          supported: true,
          configurable: true,
          configuredEnabled: true,
          effectiveDisabled: false,
          savedDisabled: false,
        })),
      },
    }),
    reload: async () => {
      throw new Error("No reload expected")
    },
    preference: async () => {
      throw new Error("No toggle expected")
    },
  }
  function Harness() {
    const keymap = createDefaultOpenTuiKeymap(useRenderer())
    return (
      <ApexoKeymapProvider keymap={keymap}>
        <HooksBrowser
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
    expect(frame).toMatch(/^\s*Hooks\s*$/m)
    expect(frame).toContain("↑/↓ select · space enable/disable · r refresh snapshot · l reload · esc close")
    expect(frame).toContain("Reload waits for a safe boundary. It does not start model work.")
    expect(frame).toContain("Choices are saved globally and applied to this session.")
    expect(frame).toContain("Snapshot generation: 1")
  } finally {
    app.renderer.destroy()
  }
})

test("HooksBrowser renders repository Hook trust and toggles trust on t key", async () => {
  const trustCalls: Array<{ root: string; token: string; trusted: boolean; allowed: boolean }> = []
  let trusted = false
  const snapshot = () => ({
    captured: true,
    generation: 1,
    repository: {
      root: "/repo/root",
      token: "token_repo_root",
      trusted,
      allowed: trusted,
    },
    inspection: {
      projectTrusted: trusted,
      diagnostics: [],
      hooks: [],
    },
  })
  const actions: HooksActions = {
    get: async () => snapshot(),
    reload: async () => snapshot(),
    preference: async () => snapshot(),
    trust: async (repository) => {
      trustCalls.push(repository)
      trusted = repository.trusted
      return snapshot()
    },
  }
  function Harness() {
    const keymap = createDefaultOpenTuiKeymap(useRenderer())
    return (
      <ApexoKeymapProvider keymap={keymap}>
        <HooksBrowser
          actions={actions}
          onClose={() => {}}
          height={24}
          theme={() => ({ text: "white", muted: "gray", error: "red", highlight: "cyan" })}
        />
      </ApexoKeymapProvider>
    )
  }
  const app = await testRender(() => <Harness />, { width: 120, height: 30 })
  try {
    await app.renderOnce()
    await app.renderOnce()
    const before = app.captureCharFrame()
    expect(before).toContain("Repository hook trust")
    expect(before).toContain("/repo/root")
    expect(before).toContain("t Allow repository hooks")

    app.mockInput.pressKey("t")
    await Bun.sleep(20)
    await app.renderOnce()
    await app.renderOnce()
    expect(trustCalls).toEqual([
      {
        root: "/repo/root",
        token: "token_repo_root",
        trusted: true,
        allowed: false,
      },
    ])
    const after = app.captureCharFrame()
    expect(after).toContain("t Revoke repository hook trust")
  } finally {
    app.renderer.destroy()
  }
})

