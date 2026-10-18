import { describe, expect, test } from "bun:test"
import { parseGoalCommand } from "../src/v2/goal-command"

describe("parseGoalCommand", () => {
  test("empty opens the panel", () => {
    expect(parseGoalCommand("")).toEqual({ type: "open" })
    expect(parseGoalCommand("/goal")).toEqual({ type: "open" })
  })
  test("operations", () => {
    for (const op of ["status", "pause", "resume", "clear"])
      expect(parseGoalCommand(`/goal ${op}`)).toEqual({ type: "operation", operation: op as "status" })
  })
  test("objective without budget", () => {
    expect(parseGoalCommand("/goal Migrate auth, tests green")).toEqual({
      type: "create",
      objective: "Migrate auth, tests green",
    })
  })
  test("--budget in either form and position", () => {
    expect(parseGoalCommand("Fix tests --budget 5000")).toEqual({
      type: "create",
      objective: "Fix tests",
      tokenBudget: 5000,
    })
    expect(parseGoalCommand("--budget=200 Fix tests now")).toEqual({
      type: "create",
      objective: "Fix tests now",
      tokenBudget: 200,
    })
  })
  test("invalid budgets are rejected, not folded into the objective", () => {
    expect(parseGoalCommand("Fix --budget 0")).toEqual({ type: "invalid", objective: "Fix", reason: "budget" })
    expect(parseGoalCommand("Fix --budget abc")).toEqual({ type: "invalid", objective: "Fix", reason: "budget" })
    expect(parseGoalCommand("--budget 10")).toEqual({ type: "invalid", objective: "", reason: "budget" })
  })
  test("a word containing budget is not a flag", () => {
    expect(parseGoalCommand("Cut the --budgetary code")).toEqual({
      type: "create",
      objective: "Cut the --budgetary code",
    })
  })
})
