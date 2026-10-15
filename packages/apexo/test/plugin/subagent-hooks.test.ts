import { expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { ConfigHooks } from "@apexo/core/config/hooks"
import { HookObserver } from "@apexo/core/hook-observer"
import { HostHooks } from "@apexo/core/hooks"
import { SessionHookStop } from "@apexo/core/session/hook-stop"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionMessage } from "@apexo/core/session/message"
import { emptyHookSelection } from "../fixture/hook-preferences"
import { tmpdir } from "../fixture/fixture"

test("Subagent aliases normalize once, preserve matcher type and ignore completion notifications", async () => {
  await using tmp = await tmpdir()
  const group = { matcher: "helper", hooks: [{ type: "command", command: "echo gate >> observed" }] }
  const hooks = ConfigHooks.normalize({
    SubagentStop: [group],
    SubagentEnd: [group],
    subagent_end: [group],
    subagentEnd: [group],
    SubagentStart: [{ matcher: "helper", hooks: [{ type: "command", command: "cat > start.json; exit 2" }] }],
  })
  expect(hooks.SubagentStop).toEqual([group])
  expect(ConfigHooks.normalize({ Stop: [group], stop: [group] }).Stop).toEqual([group, group])
  expect(ConfigHooks.canonicalEvent("SubagentFinished")).toBeUndefined()
  const registry: HostHooks.Inspection = {
    projectTrusted: false,
    diagnostics: [],
    sources: [{ name: "captured", root: tmp.path, host: true, hooks }],
  }
  await Effect.runPromise(
    HookObserver.observe({
      directory: tmp.path,
      sessionID: "parent",
      event: "SubagentStart",
      matcher: "helper",
      enabled: true,
      payload: { subagent_id: "child", subagent_type: "helper" },
      registry,
      selection: emptyHookSelection,
    }),
  )
  expect(await Bun.file(path.join(tmp.path, "start.json")).json()).toMatchObject({
    hook_event_name: "SubagentStart",
    session_id: "parent",
    subagent_id: "child",
    subagent_type: "helper",
  })
  const input = {
    directory: tmp.path,
    sessionID: SessionSchema.ID.create(),
    messageID: SessionMessage.ID.create(),
    engine: "v2" as const,
    enabled: true,
    continuations: 0,
    registry,
    selection: emptyHookSelection,
  }
  expect(await SessionHookStop.dispatch({ ...input, subagent: { type: "wrong-type" } })).toEqual({
    continue: false,
    forceStop: false,
  })
  expect(await Bun.file(path.join(tmp.path, "observed")).exists()).toBe(false)
  await SessionHookStop.dispatch({ ...input, subagent: { type: "helper" } })
  expect(await Bun.file(path.join(tmp.path, "observed")).text()).toBe("gate\n")
})

test("Subagent gate errors, invalid replies and timeout fail open; exit two and force stop keep decision semantics", async () => {
  await using tmp = await tmpdir()
  for (const fixture of [
    { command: "exit 1", expected: { continue: false, forceStop: false } },
    { command: "printf invalid", expected: { continue: false, forceStop: false } },
    { command: "sleep 10", expected: { continue: false, forceStop: false } },
    { command: "echo verify >&2; exit 2", expected: { continue: true, forceStop: false, reason: "verify" } },
    {
      command: `printf '%s' '{"decision":"block","reason":"ignore","continue":false,"stopReason":"done"}'`,
      expected: { continue: false, forceStop: true, reason: "done" },
    },
  ]) {
    const registry: HostHooks.Inspection = {
      projectTrusted: false,
      diagnostics: [],
      sources: [
        {
          name: "captured",
          root: tmp.path,
          host: true,
          hooks: {
            SubagentStop: [{ matcher: "helper", hooks: [{ type: "command", timeout: 0.1, command: fixture.command }] }],
          },
        },
      ],
    }
    expect(
      await SessionHookStop.dispatch({
        directory: tmp.path,
        sessionID: SessionSchema.ID.create(),
        messageID: SessionMessage.ID.create(),
        engine: "v2",
        enabled: true,
        continuations: 0,
        registry,
        selection: emptyHookSelection,
        subagent: { type: "helper" },
      }),
    ).toEqual(fixture.expected)
  }
})
