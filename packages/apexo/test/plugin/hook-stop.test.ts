import { emptyHookSelection } from "../fixture/hook-preferences"
import { HostHooks } from "@apexo/core/hooks"
import { hookTLS } from "../fixture/hook-tls"
import { expect, test } from "bun:test"
import path from "node:path"
import { SessionHookStop } from "@apexo/core/session/hook-stop"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionMessage } from "@apexo/core/session/message"
import { tmpdir } from "../fixture/fixture"

test("Stop command responses aggregate context, expose active state and force-stop wins", async () => {
  await using tmp = await tmpdir()
  const input = {
    sessionID: SessionSchema.ID.create(),
    messageID: SessionMessage.ID.create(),
    engine: "v1" as const,
    directory: tmp.path,
    home: path.join(tmp.path, "home"),
    enabled: true,
    continuations: 1,
  }
  const config = path.join(input.home, "hooks/stop.json")
  await Bun.write(
    config,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: 'cat > input.json; printf \'%s\' \'{"decision":"block","reason":"verify tests"}\'',
              },
              {
                type: "command",
                command: 'printf \'%s\' \'{"hookSpecificOutput":{"additionalContext":"check logs"}}\'',
              },
            ],
          },
        ],
      },
    }),
  )
  expect(
    await SessionHookStop.dispatch({
      ...{ ...input, registry: await HostHooks.discover(input.directory, input.home) },
      selection: emptyHookSelection,
    }),
  ).toEqual({
    continue: true,
    forceStop: false,
    reason: "verify tests\ncheck logs",
  })
  expect(await Bun.file(path.join(tmp.path, "input.json")).json()).toMatchObject({
    hook_event_name: "Stop",
    stop_hook_active: true,
  })
  await Bun.write(
    config,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: 'printf \'%s\' \'{"decision":"block","reason":"keep working"}\'' },
              { type: "command", command: 'printf \'%s\' \'{"continue":false,"stopReason":"enough"}\'' },
            ],
          },
        ],
      },
    }),
  )
  expect(
    await SessionHookStop.dispatch({
      ...{ ...input, registry: await HostHooks.discover(input.directory, input.home) },
      selection: emptyHookSelection,
    }),
  ).toEqual({ continue: false, forceStop: true, reason: "enough" })
})

test("Stop exit two requests continuation but crashes, invalid JSON and timeout fail open", async () => {
  await using tmp = await tmpdir()
  const input = {
    sessionID: SessionSchema.ID.create(),
    messageID: SessionMessage.ID.create(),
    engine: "v1" as const,
    directory: tmp.path,
    home: path.join(tmp.path, "home"),
    enabled: true,
    continuations: 0,
  }
  const config = path.join(input.home, "hooks/stop.json")
  await Bun.write(
    config,
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "printf 'finish verification' >&2; exit 2" }] }] },
    }),
  )
  expect(
    await SessionHookStop.dispatch({
      ...{ ...input, registry: await HostHooks.discover(input.directory, input.home) },
      selection: emptyHookSelection,
    }),
  ).toEqual({
    continue: true,
    forceStop: false,
    reason: "finish verification",
  })
  await Bun.write(
    config,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "exit 1" },
              { type: "command", command: "printf '{invalid'" },
              { type: "command", command: "sleep 10", timeout: 0.1 },
            ],
          },
        ],
      },
    }),
  )
  expect(
    await SessionHookStop.dispatch({
      ...{ ...input, registry: await HostHooks.discover(input.directory, input.home) },
      selection: emptyHookSelection,
    }),
  ).toEqual({ continue: false, forceStop: false })
})

test("Stop HTTP dispatch caps context and ignores untrusted project commands", async () => {
  await using tmp = await tmpdir()
  using tls = hookTLS()
  const server = Bun.serve({
    tls: tls.tls,
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      expect(await request.json()).toMatchObject({ hook_event_name: "Stop" })
      return Response.json({ hookSpecificOutput: { additionalContext: "x".repeat(100_000) } })
    },
  })
  try {
    const home = path.join(tmp.path, "home")
    await Bun.write(
      path.join(home, "hooks/http.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "http", url: `https://127.0.0.1:${server.port}` }] }] } }),
    )
    await Bun.write(
      path.join(tmp.path, ".grok/hooks/project.json"),
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "printf '%s' '{\"continue\":false}'" }] }] },
      }),
    )
    const result = await SessionHookStop.dispatch({
      ...{
        registry: await HostHooks.discover(tmp.path, home),
        sessionID: SessionSchema.ID.create(),
        messageID: SessionMessage.ID.create(),
        engine: "v1" as const,
        directory: tmp.path,
        home,
        enabled: true,
        continuations: 0,
      },
      selection: emptyHookSelection,
    })
    expect(result.continue).toBe(true)
    expect(result.reason?.length).toBe(64 * 1024)
  } finally {
    await server.stop(true)
  }
})
