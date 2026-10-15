import { expect, test } from "bun:test"
import { WorkflowLimits } from "@apexo/core/workflow/limits"

test("workflow host journal rejects cumulative receipt bytes and excess call count", () => {
  expect(() => WorkflowLimits.journal(Array.from({ length: 10_000 }, () => null))).not.toThrow()
  expect(() => WorkflowLimits.journal(Array.from({ length: 10_001 }, () => null))).toThrow("journal capacity")
  const receipt = { id: 1, result: "x".repeat(999_000) }
  expect(() => WorkflowLimits.journal(Array.from({ length: 16 }, () => receipt))).not.toThrow()
  expect(() => WorkflowLimits.journal(Array.from({ length: 17 }, () => receipt))).toThrow("journal capacity")
})

test("workflow host values account for serialized UTF-8 size", () => {
  expect(() => WorkflowLimits.value("x".repeat(999_998))).not.toThrow()
  expect(() => WorkflowLimits.value("x".repeat(999_999))).toThrow("value capacity")
  expect(() => WorkflowLimits.value("界".repeat(333_333))).toThrow("value capacity")
})

test("host admission reserves receipt capacity before side effects", () => {
  const receipt = { id: 1, result: "x".repeat(999_000) }
  expect(() => WorkflowLimits.admit(Array.from({ length: 15 }, () => receipt))).not.toThrow()
  expect(() => WorkflowLimits.admit(Array.from({ length: 16 }, () => receipt))).toThrow("journal capacity")
  expect(() => WorkflowLimits.admit(Array.from({ length: 10_000 }, () => null))).toThrow("journal capacity")
})
