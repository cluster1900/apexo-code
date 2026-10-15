import { emptyHookSelection } from "../fixture/hook-preferences"
import { hookTLS } from "../fixture/hook-tls"
import { expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { HostHooks } from "@apexo/core/hooks"
import { HookObserver } from "@apexo/core/hook-observer"
import { ConfigHooks } from "@apexo/core/config/hooks"
import { tmpdir } from "../fixture/fixture"

test("event aliases normalize and merge handlers without executing inspection", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  await Bun.write(
    path.join(home, "hooks/aliases.json"),
    JSON.stringify({
      hooks: {
        pre_tool_use: [{ hooks: [{ type: "command", command: "exit 2" }] }],
        beforeReadFile: [{ hooks: [{ type: "http", url: "http://invalid.test" }] }],
        stopCancelled: [{ hooks: [{ type: "command", command: "exit 0" }] }],
      },
    }),
  )
  const inspection = await HostHooks.inspect(tmp.path, home)
  expect(inspection.hooks.map((item) => item.event)).toEqual(["PreToolUse", "PreToolUse", "StopCancelled"])
  expect(inspection.hooks.every((item) => item.supported)).toBe(true)
  expect(ConfigHooks.canonicalEvent("beforeSubmitPrompt")).toBe("UserPromptSubmit")
  expect(ConfigHooks.canonicalEvent("afterAgentResponse")).toBe("PostToolUse")
})

test("observer handler decisions cannot block and matchers select actual notification types", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  const calls: Record<string, unknown>[] = []
  using tls = hookTLS()
  using server = Bun.serve({
    tls: tls.tls,
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      calls.push(await request.json())
      return Response.json({ continue: false, decision: "block" })
    },
  })
  await Bun.write(
    path.join(home, "hooks/observe.json"),
    JSON.stringify({
      hooks: {
        notification: [
          { matcher: "wrong", hooks: [{ type: "http", url: server.url.href }] },
          { matcher: "permission_prompt", hooks: [{ type: "http", url: server.url.href }] },
        ],
      },
    }),
  )
  const input = {
    registry: await HostHooks.discover(tmp.path, home),
    home,
    directory: tmp.path,
    event: "Notification" as const,
    sessionID: "session",
    matcher: "permission_prompt",
    payload: { notificationType: "permission_prompt" },
  }
  await Effect.runPromise(HookObserver.observe({ ...{ ...input, enabled: false }, selection: emptyHookSelection }))
  expect(calls).toHaveLength(0)
  await Effect.runPromise(HookObserver.observe({ ...{ ...input, enabled: true }, selection: emptyHookSelection }))
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    hook_event_name: "Notification",
    hookEventName: "notification",
    session_id: "session",
    sessionId: "session",
  })
})

test("permission denial payload preserves actual call arguments and bounds oversized input", () => {
  expect(
    HookObserver.deniedPayload({ sessionID: "s", callID: "call", toolName: "read", toolInput: { path: "actual.txt" } }),
  ).toMatchObject({ toolName: "read", toolUseId: "call", toolInput: { path: "actual.txt" }, toolInputTruncated: false })
  const large = HookObserver.deniedPayload({
    sessionID: "s",
    callID: "call",
    toolName: "write",
    toolInput: { text: "x".repeat(100_000) },
  })
  expect(large.toolInputTruncated).toBe(true)
  expect(String(large.toolInput).length).toBe(64 * 1024)
})
