import { describe, expect, test } from "bun:test"
import { readPartText, stripInlineThink } from "@apexo/session-ui/message-part-text"

describe("stripInlineThink and readPartText", () => {
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
})
