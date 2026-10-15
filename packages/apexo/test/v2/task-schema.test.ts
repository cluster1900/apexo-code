import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Task } from "@apexo/schema/task"
import { SessionID } from "@apexo/schema/session-id"

for (const background of [undefined, false, true]) {
  test(`Task background wire flag preserves ${background} and omits undefined`, () => {
    const encoded = Schema.encodeSync(Task.Summary)({
      id: SessionID.make("ses_child"),
      parentSessionID: SessionID.make("ses_parent"),
      description: "Inspect source",
      status: "running",
      startedAt: 4,
      background,
    })
    expect(Object.hasOwn(encoded, "background")).toBe(background !== undefined)
    expect(Schema.decodeUnknownSync(Task.Summary)(encoded).background).toBe(background)
  })
}
