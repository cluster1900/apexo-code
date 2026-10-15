/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { ApexoKeymapProvider, registerApexoKeymap } from "@apexo/tui/keymap"
import type { TaskMessageInput } from "@apexo/sdk/v2/client"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { taskMessageDraft } from "@apexo/sdk/v2/task-message"
import type { TaskItem } from "@apexo/tui/util/session-tasks"
import { RunTasksBody } from "@/cli/cmd/run/footer.tasks"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test.each(["running", "completed"] as const)(
  "%s Task editor preserves a held send only for its original child",
  async (status) => {
    const arrived = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const requests: string[] = []
    const closed: boolean[] = []
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        requests.push(new URL(request.url).pathname)
        const input: TaskMessageInput = await request.json()
        arrived.resolve()
        await release.promise
        return Response.json({
          inputID: input.inputID,
          taskID: "child-one",
          status: "admitted",
          delivery: "steer",
          admittedAt: 1,
        })
      },
    })
    const client = createApexoClient({ baseUrl: server.url.origin })
    const item: TaskItem = {
      id: "child-one",
      key: "native-task:child-one",
      source: "native-task",
      type: "task",
      title: "Original child",
      status,
      started_at: 1,
      sessionID: "parent",
      background: true,
    }
    const [items, setItems] = createSignal([item])
    const draft = taskMessageDraft(client, "parent", item.id, item.started_at)!
    draft.edit("Original correction")
    let dispose = () => {}
    function Harness() {
      const renderer = useRenderer()
      const keymap = createDefaultOpenTuiKeymap(renderer)
      dispose = registerApexoKeymap(keymap, renderer, createTuiResolvedConfig())
      return (
        <ApexoKeymapProvider keymap={keymap}>
          <RunTasksBody
            theme={() => RUN_THEME_FALLBACK.footer}
            tasks={items}
            native={() => true}
            error={() => undefined}
            onClose={() => {
              closed.push(true)
            }}
            actions={{
              get: async (target) => ({ ...items().find((item) => item.id === target.id)!, output: "" }),
              messageDraft: (target) => taskMessageDraft(client, "parent", target.id, target.started_at),
              cancel: async () => {},
              wait: async () => {
                throw new Error("No process in fixture")
              },
              changeSchedule: async () => {
                throw new Error("No schedule in fixture")
              },
            }}
          />
        </ApexoKeymapProvider>
      )
    }
    const app = await testRender(() => <Harness />, { width: 80, height: 24, kittyKeyboard: true })
    try {
      await app.renderOnce()
      await app.renderOnce()
      app.mockInput.pressKey("m")
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Message this Task")
      expect(app.captureCharFrame()).toContain("child-one")
      app.mockInput.pressKey("ESCAPE")
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Message this Task")
      expect(closed).toEqual([])
      app.mockInput.pressKey("m")
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Original correction")
      app.mockInput.pressKey("s", { ctrl: true })
      await arrived.promise
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Sending")
      setItems([
        { ...item, id: "child-two", key: "native-task:child-two", title: "Prepended child", started_at: 2 },
        item,
      ])
      await app.renderOnce()
      expect(app.captureCharFrame()).not.toContain("Message this Task")
      await Bun.sleep(0)
      expect(draft.state().input?.text).toBe("Original correction")
      app.mockInput.pressKey("m")
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("child-two")
      expect(app.captureCharFrame()).not.toContain("Original correction")
      expect(requests).toEqual(["/api/session/parent/task/child-one/message"])
    } finally {
      release.resolve()
      dispose()
      app.renderer.destroy()
      await server.stop(true)
    }
  },
)
