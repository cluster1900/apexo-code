import { expect, test } from "bun:test"
import { createApexoClient } from "@apexo/sdk/v2"
import { sessionTransport } from "@apexo/tui/transport/session"
import { taskActions } from "@apexo/tui/util/session-tasks"
import { goalActions } from "@apexo/tui/component/session-goal"

for (const mode of ["native", "compatibility"] as const) {
  test(`Session panels share explicit ${mode} choice on a mixed host`, async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname
        requests.push(path)
        if (path.endsWith("/goal")) return Response.json(null)
        if (path.endsWith("/task") || path.endsWith("/process") || path.endsWith("/schedule")) return Response.json([])
        if (path === "/global/health") return Response.json({ healthy: true, version: "test" })
        return new Response("Unexpected fixture route", { status: 404 })
      },
    })
    try {
      const client = createApexoClient({ baseUrl: server.url.href })
      const transport = sessionTransport(client, undefined, mode)
      const selected = async (signal: AbortSignal) => (await transport(signal)).kind
      const tasks = taskActions(client, () => "parent", selected)
      const goals = goalActions(
        client,
        async () => "parent",
        () => undefined,
        selected,
      )
      const signal = new AbortController().signal
      expect(await tasks.list(signal)).toEqual({ native: mode === "native", items: [], issues: [] })
      expect(await goals.get(signal)).toBeNull()
      expect(requests.toSorted()).toEqual(
        (mode === "native"
          ? [
              "/api/session/parent/task",
              "/api/session/parent/process",
              "/api/session/parent/schedule",
              "/api/session/parent/goal",
            ]
          : ["/experimental/session/parent/task", "/session/parent/goal"]
        ).toSorted(),
      )
    } finally {
      await server.stop(true)
    }
  })
}
