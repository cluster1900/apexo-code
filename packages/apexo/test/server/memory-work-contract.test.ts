import { expect, test } from "bun:test"
import { Schema } from "effect"
import { MemoryWork } from "@apexo/schema/memory-work"

test("memory operation contract omits absent result fields", () => {
  expect(
    Schema.encodeSync(MemoryWork.Info)({
      id: "work",
      kind: "flush",
      state: "running",
      startedAt: 1,
      result: undefined,
      finishedAt: undefined,
    }),
  ).toEqual({ id: "work", kind: "flush", state: "running", startedAt: 1 })
  expect(
    Schema.encodeSync(MemoryWork.Result)({ status: "completed", processed: 1, chars: undefined, reason: undefined }),
  ).toEqual({
    status: "completed",
    processed: 1,
  })
  expect(Schema.encodeSync(MemoryWork.Result)({ status: "retry_required", eligible: 2 })).toEqual({
    status: "retry_required",
    eligible: 2,
  })
})

test("memory operation contract rejects invalid counts, timestamps and actions", () => {
  for (const startedAt of [-1, 0.5, Infinity, NaN])
    expect(() =>
      Schema.decodeUnknownSync(MemoryWork.Info)({ id: "work", kind: "flush", state: "running", startedAt }),
    ).toThrow()
  expect(() => Schema.decodeUnknownSync(MemoryWork.Result)({ status: "completed", processed: -1 })).toThrow()
  expect(() => Schema.decodeUnknownSync(MemoryWork.Start)({ kind: "unknown" })).toThrow()
  expect(() => Schema.decodeUnknownSync(MemoryWork.Cancel)({ id: "" })).toThrow()
  expect(
    Schema.decodeUnknownSync(MemoryWork.Result)({ status: "shadow", processed: 20, topics: 3, cleaned: 0 }),
  ).toEqual({ status: "shadow", processed: 20, topics: 3, cleaned: 0 })
  expect(() => Schema.decodeUnknownSync(MemoryWork.Result)({ status: "completed", topics: -1 })).toThrow()
})

test("memory operation identifies historical ownership conflicts without arbitrary error text", () => {
  const result = { status: "conflict", reason: "historical_capture_ownership" } as const
  expect(Schema.decodeUnknownSync(MemoryWork.Result)(result)).toEqual(result)
  expect(Schema.encodeSync(MemoryWork.Result)(result)).toEqual(result)
  expect(() =>
    Schema.decodeUnknownSync(MemoryWork.Result)({ status: "conflict", reason: "unrecognized_reason" }),
  ).toThrow()
})
