import { expect, test } from "bun:test"
import { Event } from "@apexo/schema/event"
import { SessionID } from "@apexo/schema/session-id"
import { SessionMessage } from "@apexo/schema/session-message"
import { nativeHeadlessOutput } from "@/cli/native-headless-output"
import { validateNativeInputID } from "@/cli/native-headless"

function fixture(format: "json" | "streaming-json") {
  const sessionID = SessionID.create()
  const inputID = SessionMessage.ID.create()
  const text: string[] = []
  const errors: string[] = []
  const output = nativeHeadlessOutput({
    sessionID,
    inputID,
    directory: "/workspace",
    format,
    thinking: true,
    write: (value) => text.push(value),
    error: (value) => errors.push(value),
  })
  const event = (type: string, data: Record<string, unknown>, seq?: number) => ({
    id: Event.ID.create(),
    type,
    data: { timestamp: 1000, sessionID, ...data },
    ...(seq === undefined ? {} : { durable: { aggregateID: sessionID, seq, version: 1 } }),
  })
  return { sessionID, inputID, text, errors, output, event }
}

test("headless output attributes turns to canonical input, deduplicates replay, and ignores server notifications", () => {
  const f = fixture("json")
  const old = SessionMessage.ID.create()
  const current = SessionMessage.ID.create()
  const later = SessionMessage.ID.create()
  const turns = [
    [SessionMessage.ID.create(), old, "OLD"],
    [f.inputID, current, "OWNED"],
    [SessionMessage.ID.create(), later, "NEWER"],
  ] as const
  f.output.apply({ id: Event.ID.create(), type: "server.connected", data: {} })
  const events = turns.flatMap(([inputID, assistantMessageID, text], index) => [
    f.event("session.next.prompted", { messageID: inputID, prompt: { text }, delivery: "steer" }, index * 5 + 1),
    f.event(
      "session.next.step.started",
      { assistantMessageID, agent: "build", model: { id: "test", providerID: "test" } },
      index * 5 + 2,
    ),
    f.event("session.next.text.started", { assistantMessageID, textID: `${index}:text` }, index * 5 + 3),
    f.event("session.next.text.ended", { assistantMessageID, textID: `${index}:text`, text }, index * 5 + 4),
    f.event(
      "session.next.step.ended",
      {
        assistantMessageID,
        finish: "stop",
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      index * 5 + 5,
    ),
  ])
  events.forEach(f.output.apply)
  events.forEach(f.output.apply)
  const result = f.text.map((line) => JSON.parse(line))
  expect(result.map((item) => item.type)).toEqual(["step_start", "text", "step_finish"])
  expect(result.find((item) => item.type === "text").part.text).toBe("OWNED")
  expect(f.errors).toEqual([])
  expect(() => f.output.apply({ type: "session.next.step.started", data: {} })).toThrow()
})

test("streaming output recovers the missing durable suffix and emits terminal evidence once", () => {
  const f = fixture("streaming-json")
  const assistantMessageID = SessionMessage.ID.create()
  f.output.apply(
    f.event("session.next.prompted", { messageID: f.inputID, prompt: { text: "own" }, delivery: "steer" }, 1),
  )
  f.output.apply(
    f.event(
      "session.next.step.started",
      { assistantMessageID, agent: "build", model: { id: "test", providerID: "test" } },
      2,
    ),
  )
  f.output.apply(f.event("session.next.text.started", { assistantMessageID, textID: "text" }, 3))
  const fragment = f.event("session.next.text.delta", { assistantMessageID, textID: "text", delta: "First " })
  f.output.apply(fragment)
  f.output.apply(fragment)
  f.output.apply(f.event("session.next.text.ended", { assistantMessageID, textID: "text", text: "First complete" }, 4))
  f.output.apply(f.event("session.next.text.delta", { assistantMessageID, textID: "text", delta: "late" }))
  const execution = {
    id: f.inputID,
    sessionID: f.sessionID,
    policy: { mode: "headless", permissions: "reject" },
    status: "superseded",
    reason: "superseded",
    admittedSeq: 1,
    endedSeq: 5,
    usageIncomplete: true,
  } as const
  f.output.finish(execution)
  f.output.finish(execution)
  const result = f.text.map((line) => JSON.parse(line))
  expect(
    result
      .filter((item) => item.type === "text")
      .map((item) => item.data)
      .join(""),
  ).toBe("First complete")
  expect(result.filter((item) => item.type === "input_execution")).toHaveLength(1)
  expect(result.at(-1)).toMatchObject({
    type: "end",
    requestId: f.inputID,
    status: "superseded",
    usageIncomplete: true,
  })
})

test("explicit retry identity is validated before startup", () => {
  expect(() => validateNativeInputID({ inputID: "invalid", session: "ses_fixture" })).toThrow()
  expect(() => validateNativeInputID({ inputID: SessionMessage.ID.create() })).toThrow()
  expect(() =>
    validateNativeInputID({ inputID: SessionMessage.ID.create(), session: "ses_fixture", mini: true }),
  ).toThrow()
  expect(() => validateNativeInputID({ inputID: SessionMessage.ID.create(), session: "ses_fixture" })).not.toThrow()
})

test("distinct assistant turns may reuse provider fragment IDs without losing output", () => {
  const f = fixture("json")
  f.output.apply(
    f.event("session.next.prompted", { messageID: f.inputID, prompt: { text: "own" }, delivery: "steer" }, 1),
  )
  for (const [index, text] of ["FIRST", "SECOND"].entries()) {
    const assistantMessageID = SessionMessage.ID.create()
    f.output.apply(
      f.event(
        "session.next.step.started",
        { assistantMessageID, agent: "build", model: { id: "test", providerID: "test" } },
        index * 4 + 2,
      ),
    )
    f.output.apply(
      f.event("session.next.text.started", { assistantMessageID, textID: "same-provider-id" }, index * 4 + 3),
    )
    f.output.apply(
      f.event("session.next.text.ended", { assistantMessageID, textID: "same-provider-id", text }, index * 4 + 4),
    )
    f.output.apply(
      f.event(
        "session.next.step.ended",
        {
          assistantMessageID,
          finish: "stop",
          cost: 0,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        index * 4 + 5,
      ),
    )
  }
  expect(
    f.text
      .map((line) => JSON.parse(line))
      .filter((event) => event.type === "text")
      .map((event) => event.part.text),
  ).toEqual(["FIRST", "SECOND"])
})
