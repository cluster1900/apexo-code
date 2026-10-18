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
    { permission: "linear_create_issue", pattern: "*", action: "allow" },
    { permission: "slack_read_thread", pattern: "*", action: "allow" },
    { permission: "linear_delete_issue", pattern: "*", action: "deny" },
  ],
}

const fakeClient = {
  callTool: async () => ({ isError: false, content: [{ type: "text" as const, text: "echo result" }] }),
}

const mcp = MCP.Service.of({
  tools: () =>
    Effect.succeed({
      linear_create_issue: {
        def: {
          name: "create_issue",
          description: "Create a new Linear issue",
          inputSchema: { type: "object", properties: { title: { type: "string" } } },
        },
        client: fakeClient,
      },
      slack_read_thread: {
        def: {
          name: "read_thread",
          description: "Read Slack thread history",
          inputSchema: { type: "object", properties: { channel: { type: "string" } } },
        },
        client: fakeClient,
      },
      linear_delete_issue: {
        def: {
          name: "delete_issue",
          description: "Delete a Linear issue",
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

it.effect("search_tool/use_tool discover permitted MCP tools and dispatch qualified names like Grok Build", () =>
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

    expect(Object.keys(tools).toSorted()).toEqual(["search_tool", "use_tool"])
    expect(tools.search_tool?.description).toContain("Connected MCP servers:\n- linear (1 tool)\n- slack (1 tool)")
    const opts = { toolCallId: callID, abortSignal: new AbortController().signal, messages: [] }
    const search = tools.search_tool!.execute!
    const use = tools.use_tool!.execute!

    const found = (yield* Effect.promise(() => search({ query: "linear create issue" }, opts))) as { output: string }
    const parsed = JSON.parse(found.output)
    expect(parsed.results[0].server).toBe("linear")
    expect(parsed.results[0].tools[0].tool_name).toBe("linear__create_issue")
    expect(parsed.results[0].tools[0].input_schema.properties.title.type).toBe("string")
    expect(parsed.total_hidden_tools).toBe(2)
    expect(found.output).not.toContain("delete_issue")

    const result = (yield* Effect.promise(() =>
      use({ tool_name: "linear__create_issue", tool_input: '{"title":"x"}' }, opts),
    )) as { output: string }
    expect(result.output).toContain("echo result")

    const native = yield* Effect.promise(() => Promise.resolve(use({ tool_name: "search_tool", tool_input: {} }, opts)).catch((e: Error) => e.message))
    expect(String(native)).toContain("is a native tool")
    const bare = yield* Effect.promise(() => Promise.resolve(use({ tool_name: "create_issue" }, opts)).catch((e: Error) => e.message))
    expect(String(bare)).toContain("must be qualified as `server__tool`")
    const denied = yield* Effect.promise(() => Promise.resolve(use({ tool_name: "linear__delete_issue" }, opts)).catch((e: Error) => e.message))
    expect(String(denied)).toContain("Unknown or denied")
  }),
)
