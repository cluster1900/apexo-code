import { expect, test } from "bun:test"
import { MemoryTranscript } from "@apexo/core/memory-transcript"
import { SessionV1 } from "@apexo/core/v1/session"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { MessageID, PartID, SessionID } from "@/session/schema"

function turn(text: string, synthetic = false): SessionV1.WithParts[] {
  const sessionID = SessionID.make("ses_memory_capture")
  const id = MessageID.ascending()
  const reply = MessageID.ascending()
  return [
    {
      info: {
        id,
        sessionID,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
      },
      parts: [{ id: PartID.ascending(), messageID: id, sessionID, type: "text", text, synthetic }],
    },
    {
      info: {
        id: reply,
        sessionID,
        role: "assistant",
        parentID: id,
        agent: "build",
        mode: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        time: { created: 2, completed: 3 },
        modelID: ModelV2.ID.make("test"),
        providerID: ProviderV2.ID.make("test"),
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [
        { id: PartID.ascending(), messageID: reply, sessionID, type: "text", text: "A useful answer." },
        {
          id: PartID.ascending(),
          messageID: reply,
          sessionID,
          type: "reasoning",
          text: "PRIVATE_REASONING",
          time: { start: 1, end: 2 },
        },
      ],
    },
  ]
}

test("capture freezes only human completed turns, omits reasoning and preserves durable message identity", () => {
  const messages = [
    ...turn("Human request"),
    ...turn("Synthetic event", true),
    ...turn("/command arg"),
    ...turn("!shell"),
    ...turn("Second human request"),
  ]
  const rows = MemoryTranscript.turns(messages)
  expect(rows.map((row) => row.promptIndex)).toEqual([0, 8])
  expect(rows[0]!.promptID).toBe(messages[0]!.info.id)
  expect(rows[0]!.source).not.toContain("PRIVATE_REASONING")
  const source = MemoryTranscript.decode(rows[0]!.source)
  expect(source.transcript).toContain("Human request")
  expect(source.transcript).toContain("A useful answer")
  expect(rows[0]!.source).not.toContain("Second human request")
  const last = messages.at(-1)!
  if (last.info.role !== "assistant") throw new Error("Expected assistant fixture")
  last.info.finish = "tool-calls"
  expect(MemoryTranscript.turns(messages)).toHaveLength(1)
  expect(MemoryTranscript.turns(messages, true)).toHaveLength(2)
  last.info.error = { name: "MessageAbortedError", data: { message: "Interrupted" } }
  expect(MemoryTranscript.turns(messages)).toHaveLength(2)
})

test("capture bounds UTF-8 transcript, keeps file descriptions and never embeds image data", () => {
  const messages = turn("😀".repeat(100000))
  if (messages[0]!.info.role !== "user") throw new Error("Expected user fixture")
  messages[0]!.info.system = "PRIVATE_SYSTEM_CONTEXT"
  messages[0]!.info.summary = { body: "UNRELATED_GENERATED_SUMMARY", diffs: [] }
  messages[0]!.parts.push({
    id: PartID.ascending(),
    messageID: messages[0]!.info.id,
    sessionID: messages[0]!.info.sessionID,
    type: "file",
    mime: "image/png",
    filename: "diagram.png",
    url: "data:image/png;base64,PRIVATE_IMAGE",
  })
  const source = MemoryTranscript.decode(MemoryTranscript.turns(messages)[0]!.source)
  expect(Buffer.byteLength(source.transcript)).toBeLessThan(100000)
  expect(source.transcript).not.toContain("\ufffd")
  expect(source.transcript).not.toContain("PRIVATE_IMAGE")
  expect(source.transcript).toContain("diagram.png")
  expect(MemoryTranscript.turns(messages)[0]!.source).not.toContain("PRIVATE_SYSTEM_CONTEXT")
  expect(MemoryTranscript.turns(messages)[0]!.source).not.toContain("UNRELATED_GENERATED_SUMMARY")
})
