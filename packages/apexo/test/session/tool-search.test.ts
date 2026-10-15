import { expect } from "bun:test"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { SessionV1 } from "@apexo/core/v1/session"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"
import { SessionTools } from "@/session/tools"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const sessionID = SessionID.make("ses_tool_search")
const messageID = MessageID.ascending()
const callID = "call-tool-search"

const model = {
  providerID: ProviderV2.ID.make("test"),
  api: { id: "test-model" },
} as Provider.Model

const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  options: {},
  permission: [
    { permission: "echo", pattern: "*", action: "allow" },
    { permission: "secret", pattern: "*", action: "deny" },
  ],
}

const fakeClient = {
  callTool: async () => ({ isError: false, content: [{ type: "text" as const, text: "echo result" }] }),
}

const mcp = MCP.Service.of({
  tools: () =>
    Effect.succeed({
      echo: {
        def: {
          name: "echo",
          description: "Echo a value",
          inputSchema: { type: "object", properties: { value: { type: "string" } } },
        },
        client: fakeClient,
      },
      secret: {
        def: {
          name: "secret",
          description: "A denied tool",
          inputSchema: { type: "object", properties: {} },
        },
        client: fakeClient,
      },
    }),
  clients: () => Effect.succeed({}),
} as unknown as Partial<MCP.Interface> as MCP.Interface)

const layer = Layer.mergeAll(
  Layer.succeed(MCP.Service, mcp),
  Layer.succeed(
    Permission.Service,
    Permission.Service.of({
      ask: () => Effect.void,
      reply: () => Effect.void,
      list: () => Effect.succeed([]),
    }),
  ),
  Layer.succeed(
    Plugin.Service,
    Plugin.Service.of({
      init: () => Effect.void,
      list: () => Effect.succeed([]),
      trigger: (_name, _input, output) => Effect.succeed(output),
    }),
  ),
  Layer.succeed(
    ToolRegistry.Service,
    ToolRegistry.Service.of({
      scheduler: () => Effect.die("unused"),
      ids: () => Effect.succeed([]),
      all: () => Effect.succeed([]),
      named: () => Effect.die("unused"),
      tools: () => Effect.succeed([]),
    }),
  ),
  Layer.succeed(
    Truncate.Service,
    Truncate.Service.of({
      cleanup: () => Effect.void,
      write: () => Effect.succeed("output.txt"),
      output: (text: string) => Effect.succeed({ content: text, truncated: false }),
      limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
    }),
  ),
  RuntimeFlags.layer({ experimentalToolSearch: true }),
)

const it = testEffect(layer)

it.effect("catalogs only permitted MCP tools and executes an exact match", () =>
  Effect.gen(function* () {
    const tools = yield* SessionTools.resolve({
      agent,
      model,
      session: { id: sessionID, permission: [] } as unknown as Session.Info,
      processor: {
        message: {
          id: messageID,
          sessionID,
          role: "assistant",
          parentID: MessageID.ascending(),
          agent: "build",
          mode: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelV2.ID.make("test-model"),
          providerID: ProviderV2.ID.make("test"),
          time: { created: 1 },
        } satisfies SessionV1.Assistant,
        updateToolCall: () => Effect.succeed(undefined),
        completeToolCall: () => Effect.void,
      },
      bypassAgentCheck: false,
      messages: [],
      promptOps: {} as never,
    })

    expect(Object.keys(tools)).toEqual(["tool_search"])
    const search = tools.tool_search?.execute
    if (!search) throw new Error("tool_search is missing")

    const catalog = (yield* Effect.promise(() =>
      search({ query: "echo" }, { toolCallId: callID, abortSignal: new AbortController().signal, messages: [] }),
    )) as { output: string }
    expect(catalog.output).toContain('"name":"echo"')
    expect(catalog.output).not.toContain('"name":"secret"')

    const result = (yield* Effect.promise(() =>
      search(
        { tool: "echo", arguments: { value: "hello" } },
        { toolCallId: callID, abortSignal: new AbortController().signal, messages: [] },
      ),
    )) as { output: string }
    expect(result.output).toContain("echo result")
  }),
)
