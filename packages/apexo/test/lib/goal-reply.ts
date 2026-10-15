import { Effect } from "effect"
import { reply, TestLLMServer, type Usage } from "./llm-server"

/** Model fixture: send actual scoped write calls, followed by a non-authoritative terminal response. */
export const goalReply = Effect.fn(function* (
  server: TestLLMServer["Service"],
  value: string,
  opts?: { usage?: Usage },
  match?: Parameters<TestLLMServer["Service"]["textMatch"]>[0],
) {
  const parsed: unknown = value.startsWith("{") ? JSON.parse(value) : undefined
  if (!parsed || typeof parsed !== "object" || (!("plan" in parsed) && !("achieved" in parsed))) {
    if (match) return yield* server.textMatch(match, value, opts)
    return yield* server.text(value, opts)
  }
  const plan = "plan" in parsed && typeof parsed.plan === "string" ? parsed.plan : undefined
  const state = { path: "", step: 0, paths: [] as string[] }
  const paths = (body: Record<string, unknown>) => {
    const tools = body.tools as {
      function: { name: string; parameters: { properties: { file_path?: { enum?: string[] } } } }
    }[]
    return tools?.find((tool) => tool.function.name === "write")?.function.parameters.properties.file_path?.enum ?? []
  }
  // Match follow-ups to their role's unique paths, so concurrent reviewers cannot consume one another's replies.
  if (plan === undefined)
    yield* server.respond(
      () => {
        state.step = 2
        return reply()
          .tool("write", {
            file_path: state.paths[1],
            content: `# Findings\n${"evidence" in parsed ? parsed.evidence : value}`,
          })
          .usage({ input: 0, output: 0 })
          .item()
      },
      (hit) => state.step === 1 && paths(hit.body)[0] === state.path,
    )
  yield* server.respond(
    () => reply().text("Done").usage({ input: 0, output: 0 }).stop().item(),
    (hit) => state.step === (plan === undefined ? 2 : 1) && paths(hit.body)[0] === state.path,
  )
  yield* server.respond((hit) => {
    state.paths = paths(hit.body)
    state.path = state.paths[0]
    if (!state.path) throw new Error("Goal report fixture requires the scoped write tool")
    state.step = 1
    return reply()
      .tool("write", { file_path: state.path, content: plan ?? value })
      .usage(opts?.usage ?? { input: 0, output: 0 })
      .item()
  }, match)
})

export const goalReplyMatch = (
  server: TestLLMServer["Service"],
  match: Parameters<TestLLMServer["Service"]["textMatch"]>[0],
  value: string,
  opts?: { usage?: Usage },
) => goalReply(server, value, opts, match)
