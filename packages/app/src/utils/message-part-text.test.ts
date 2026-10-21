import { describe, expect, test } from "bun:test"
import { getDirectory } from "@apexo/core/util/path"
import { readPartText, stripInlineThink } from "@apexo/session-ui/message-part-text"
import { partDefaultOpen } from "@apexo/session-ui/message-part"
import { createMarkdownParser } from "@apexo/ui/context/marked-parser"
import { Timeline } from "@/pages/session/timeline/rows"
import { redactSecrets } from "@/utils/server-errors"
import { validateCustomProvider } from "@/components/dialog-custom-provider-form"
import { displayName } from "@/pages/layout/helpers"

describe("stripInlineThink and readPartText", () => {
  test("getDirectory returns empty string for bare filenames without directory separators (#35)", () => {
    expect(getDirectory("qa25.txt")).toBe("")
    expect(getDirectory("src/qa25.txt")).toBe("src/")
    expect(getDirectory("/")).toBe("/")
  })
  test("strips closed <think>...</think> blocks from text parts", () => {
    expect(stripInlineThink("<think>internal reasoning</think>\nvisible answer")).toBe("visible answer")
    expect(
      readPartText(undefined, {
        id: "part-1",
        type: "text",
        text: "<think>The user wants just hi.</think>\nhi",
      }),
    ).toBe("hi")
  })

  test("strips unclosed streaming <think> blocks from text parts", () => {
    expect(stripInlineThink("<think>still thinking...")).toBe("")
  })

  test("preserves reasoning part text untouched", () => {
    expect(
      readPartText(undefined, {
        id: "part-2",
        type: "reasoning",
        text: "reasoning content",
      }),
    ).toBe("reasoning content")
  })

  test("defaults reasoning parts to collapsed (#24)", () => {
    expect(
      partDefaultOpen({
        id: "part-r1",
        sessionID: "ses-1",
        messageID: "msg-a1",
        type: "reasoning",
        text: "thinking details",
        time: { start: 1 },
      }),
    ).toBe(false)
  })

  test("does not leak reasoning text into Thinking row when showReasoning is false (#37)", () => {
    const userMessage = {
      id: "msg-u1",
      sessionID: "ses-1",
      role: "user" as const,
      time: { created: 1 },
      agent: "build",
      model: { providerID: "xai", modelID: "grok-4" },
    }
    const assistantMessage = {
      id: "msg-a1",
      sessionID: "ses-1",
      role: "assistant" as const,
      parentID: "msg-u1",
      modelID: "grok-4",
      providerID: "xai",
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 2 },
    }
    const rows = Timeline.constructMessageRows(
      userMessage,
      (id) =>
        id === "msg-a1"
          ? [
              {
                id: "part-r1",
                sessionID: "ses-1",
                messageID: "msg-a1",
                type: "reasoning" as const,
                text: "The user wants me to create a file qa25.txt.",
                time: { start: 2 },
              },
              {
                id: "part-t1",
                sessionID: "ses-1",
                messageID: "msg-a1",
                type: "tool" as const,
                callID: "call-1",
                tool: "write",
                state: {
                  status: "running" as const,
                  input: { filePath: "/tmp/qa25.txt", content: "ok" },
                  time: { start: 3 },
                },
              },
            ]
          : [],
      [assistantMessage],
      0,
      false,
      "busy",
      true,
      false,
    )
    const thinking = rows.find((row) => row._tag === "Thinking")
    expect(thinking).toBeDefined()
    expect(thinking?._tag === "Thinking" ? thinking.reasoningHeading : undefined).toBeUndefined()
  })

  test("preserves single line breaks in markdown output (#40)", async () => {
    const parser = createMarkdownParser((code) => `<pre>${code}</pre>`)
    const html = await parser.parse("one\ntwo\nthree\nfour\nfive")
    expect(html).toContain("<br")
  })

  test("redacts short and standard API keys in error messages (#53)", () => {
    expect(redactSecrets("Incorrect API key provided: sk-test-123. You can find your API key")).toBe(
      "Incorrect API key provided: [REDACTED]. You can find your API key",
    )
    expect(redactSecrets("Invalid key xai-abc123def")).toBe("Invalid key [REDACTED]")
  })

  test("suggests unique custom provider ID when colliding with existing provider (#92)", () => {
    const res = validateCustomProvider({
      form: {
        providerID: "minimax",
        name: "MiniMax Custom",
        baseURL: "https://api.minimaxi.com/v1",
        apiKey: "",
        models: [{ row: "r1", id: "MiniMax-M2.7", name: "MiniMax M2.7", err: {} }],
        headers: [],
        err: {},
      },
      disabledProviders: [],
      existingProviderIDs: new Set(["minimax"]),
      t: (key, vars) => `${key}:${JSON.stringify(vars ?? {})}`,
    })
    expect(res.result).toBeUndefined()
    expect(res.err.providerID).toContain("minimax-custom")
  })

  test("displayName returns Default Project title when set (#54)", () => {
    expect(displayName({ worktree: "/tmp/demo", name: "Default Project" })).toBe("Default Project")
  })
})
