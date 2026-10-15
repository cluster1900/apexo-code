import { expect, test } from "bun:test"
import { MemoryBatchDream } from "@apexo/core/memory-batch-dream"
import { MemoryV2 } from "@apexo/core/memory-v2"
const content = "# Service\nService facts.\n\n## Limits\nThe limit is 10.\n\n## Unicode\n猫 is a cat.\n"
const fixture = (notes = 1, text = content) =>
  MemoryBatchDream.make({
    observations: Array.from({ length: notes }, (_, i) => ({
      path: `observations/_inbox/n${i}.md`,
      content: `Fact ${i}`,
      hash: MemoryV2.hash(`Fact ${i}`),
    })),
    topics: [{ path: "topics/service.md", content: text, hash: MemoryV2.hash(text) }],
  })
test("strict typed batch envelope rejects ambiguous or excess actions", () => {
  expect(() => MemoryBatchDream.parse('{"actions":null,"plan":null}')).toThrow()
  expect(() =>
    MemoryBatchDream.parse(
      JSON.stringify({ actions: [{ action: "list", after: null, unexpected: true }], plan: null }),
    ),
  ).toThrow()
  expect(() =>
    MemoryBatchDream.parse(
      JSON.stringify({ actions: Array.from({ length: 13 }, () => ({ action: "list", after: null })), plan: null }),
    ),
  ).toThrow()
})
test("related notes may share one exact patch with both evidence paths", () => {
  const protocol = fixture(2)
  protocol.action({ action: "read_topic", path: "topics/service.md" })
  const output = protocol.compile({
    edits: [{ kind: "patch", id: "E1", read: "R1", old_text: "10", new_text: "20" }],
    outcomes: [
      { outcome: "applied", note: "N1", edits: ["E1"] },
      { outcome: "applied", note: "N2", edits: ["E1"] },
    ],
  })
  expect(output.operations).toEqual([
    {
      action: "update",
      path: "topics/service.md",
      content: content.replace("10", "20"),
      evidence: ["observations/_inbox/n0.md", "observations/_inbox/n1.md"],
    },
  ])
})
test("reads bind UTF-8 offsets and complete sections", () => {
  const protocol = fixture()
  const start = Buffer.byteLength(content.slice(0, content.indexOf("猫")))
  expect(() =>
    protocol.action({ action: "read_range", path: "topics/service.md", start: start + 1, max_bytes: 5 }),
  ).toThrow("UTF-8")
  protocol.action({ action: "read_range", path: "topics/service.md", start, max_bytes: 3 })
  expect(() =>
    protocol.compile({
      edits: [{ kind: "replace_section", id: "E1", read: "R1", heading: "## Unicode", text: "## Unicode\nNew" }],
      outcomes: [{ outcome: "applied", note: "N1", edits: ["E1"] }],
    }),
  ).toThrow("entire section")
})
test("conflicting patches and unproven no-change cannot archive a note", () => {
  const protocol = fixture()
  expect(() =>
    protocol.compile({ edits: [], outcomes: [{ outcome: "no_change", note: "N1", evidence: ["R1"] }] }),
  ).toThrow("actual read")
  protocol.action({ action: "read_topic", path: "topics/service.md" })
  expect(() =>
    protocol.compile({
      edits: [
        { kind: "patch", id: "E1", read: "R1", old_text: "10", new_text: "20" },
        { kind: "patch", id: "E2", read: "R1", old_text: "limit is 10", new_text: "limit is 30" },
      ],
      outcomes: [{ outcome: "applied", note: "N1", edits: ["E1", "E2"] }],
    }),
  ).toThrow("overlap")
  expect(
    protocol.compile({ edits: [], outcomes: [{ outcome: "no_change", note: "N1", evidence: ["R1"] }] }).outcomes[0]
      ?.outcome,
  ).toBe("no_change")
})
test("only multi-note truncation capacity deferrals are uncounted", () => {
  const plan: MemoryBatchDream.Plan = {
    edits: [],
    outcomes: [
      { outcome: "deferred", note: "N1", reason: "batch too large" },
      { outcome: "deferred", note: "N2", reason: "Needs context" },
    ],
  }
  expect(
    fixture(2)
      .compile(plan, true)
      .outcomes.map((row) => row.uncounted),
  ).toEqual([true, false])
  expect(
    fixture(2)
      .compile(plan, false)
      .outcomes.map((row) => row.uncounted),
  ).toEqual([false, false])
})
test("repair exhaustion preserves independent valid edits and defers only invalid notes", () => {
  const protocol = fixture(2)
  protocol.action({ action: "read_topic", path: "topics/service.md" })
  const result = protocol.check({
    edits: [
      { kind: "patch", id: "E1", read: "R1", old_text: "10", new_text: "20" },
      { kind: "patch", id: "E2", read: "missing", old_text: "x", new_text: "y" },
    ],
    outcomes: [
      { outcome: "applied", note: "N1", edits: ["E1"] },
      { outcome: "applied", note: "N2", edits: ["E2"] },
    ],
  })
  expect(result.error).toBeDefined()
  expect(result.compiled?.operations.length).toBe(1)
  expect(result.compiled?.outcomes.map((row) => row.outcome)).toEqual(["applied", "deferred"])
})

test("catalog cursor uses one lexical order across mixed legacy filenames", () => {
  const paths = Array.from(
    { length: 90 },
    (_, index) => `topics/${["Z", "a", "-", "猫", "é", "Ä"][index % 6]}${index}.md`,
  )
  const protocol = MemoryBatchDream.make({
    observations: [],
    topics: [...paths]
      .sort((a, b) => a.localeCompare(b))
      .map((path) => ({ path, content, hash: MemoryV2.hash(content) })),
  })
  const first = protocol.action({ action: "list", after: null })
  if (!("entries" in first) || !first.entries || !("next" in first) || first.next === undefined)
    throw new Error("Expected catalog page")
  const second = protocol.action({ action: "list", after: first.next })
  if (!("entries" in second) || !second.entries) throw new Error("Expected catalog page")
  expect([...first.entries, ...second.entries].map((row) => row.path)).toEqual([...paths].sort())
})
