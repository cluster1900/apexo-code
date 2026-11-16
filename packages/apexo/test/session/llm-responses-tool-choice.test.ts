import { expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMClient } from "@apexo/llm"
import { configure } from "@apexo/llm/providers/xai"
import type { OpenAIResponsesBody } from "@apexo/llm/protocols/openai-responses"

test("xAI Responses omits tool_choice none when a final provider turn has no tools", async () => {
  const prepared = await Effect.runPromise(
    LLMClient.prepare<OpenAIResponsesBody>(
      LLM.request({
        model: configure({ apiKey: "fixture" }).responses("grok-4.7"),
        prompt: "Summarize the completed task.",
        tools: [],
        toolChoice: "none",
      }),
    ),
  )
  expect(prepared.body.tools).toBeUndefined()
  expect(prepared.body.tool_choice).toBeUndefined()
})

test("Responses retains an explicit none choice when tool definitions are present", async () => {
  const prepared = await Effect.runPromise(
    LLMClient.prepare<OpenAIResponsesBody>(
      LLM.request({
        model: configure({ apiKey: "fixture" }).responses("grok-4.7"),
        prompt: "Summarize without calling the provided tool.",
        tools: [{ name: "observe", description: "Read a fixture", inputSchema: { type: "object", properties: {} } }],
        toolChoice: "none",
      }),
    ),
  )
  expect(prepared.body.tools).toHaveLength(1)
  expect(prepared.body.tool_choice).toBe("none")
})
