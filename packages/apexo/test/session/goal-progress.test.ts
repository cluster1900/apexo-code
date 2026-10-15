import { expect, test } from "bun:test"
import { SessionGoalProgress } from "@apexo/core/session/goal-progress"

test("task ordinals follow the immutable explicit checklist, ignoring prose and fenced examples", () => {
  const plan =
    "# Plan\n## Acceptance criteria\n- [ ] Not a task\n## Task checklist\n- [x] Already done\n### Nested phase\n* [ ] Duplicate\n```md\n- [ ] Fenced example\n## Task checklist\n```\n+ [ ] Duplicate\n## Deviations\n- [ ] Not a task\n"
  expect(SessionGoalProgress.tasks(plan)).toEqual([
    { ordinal: 0, text: "Already done", completed: true },
    { ordinal: 1, text: "Duplicate", completed: false },
    { ordinal: 2, text: "Duplicate", completed: false },
  ])
  expect(SessionGoalProgress.update({ plan }, { complete: [2, 2] })).toEqual({
    value: { completed: [0, 2], deviations: [] },
  })
  expect(
    SessionGoalProgress.next({
      plan,
      planProgress: { completed: [0, 2], deviations: [] },
    }),
  ).toBe("Duplicate")
})

test("ambiguous, absent, oversized and over-capacity checklists do not assign valid ordinals", () => {
  for (const plan of [
    "- [ ] Unscoped",
    "## Task checklist\n- [ ] One\n## Task checklist\n- [ ] Two",
    "x".repeat(131073),
    "## Task checklist\n" + "- [ ] Task\n".repeat(129),
  ]) {
    expect(SessionGoalProgress.tasks(plan)).toBeUndefined()
    expect(SessionGoalProgress.update({ plan }, { complete: [0] }).error).toBeDefined()
  }
  const plan = "## Task checklist\n" + "- [ ] Task\n".repeat(128)
  expect(SessionGoalProgress.tasks(plan)).toHaveLength(128)
  expect(SessionGoalProgress.update({ plan }, { complete: [127] }).value?.completed).toEqual([127])
})

test("deviation-only plans work without checklist and multibyte limits do not silently truncate", () => {
  const plan = "Preserve the original outcome without a task checklist."
  expect(SessionGoalProgress.update({ plan }, { deviation: "界".repeat(170) })).toEqual({
    value: { completed: [], deviations: ["界".repeat(170)] },
  })
  expect(SessionGoalProgress.update({ plan }, { deviation: "界".repeat(171) }).error).toBeDefined()
  expect(SessionGoalProgress.update({ plan }, { complete: [0] }).error).toBeDefined()
  expect(
    SessionGoalProgress.invalid({
      plan,
      planProgress: { completed: [0], deviations: [] },
    }),
  ).toBeDefined()
})

test("progress context marks work notes advisory and preserves the original task labels", () => {
  const plan = "## Task checklist\n- [ ] " + "界".repeat(200)
  const original = SessionGoalProgress.tasks(plan)
  const rendered = SessionGoalProgress.context({
    plan,
    planProgress: {
      completed: [0],
      deviations: ["Changed approach, not scope"],
    },
  })
  expect(rendered.advisory).toBe(true)
  expect(rendered.tasks[0]?.completed).toBe(true)
  expect(rendered.tasks[0]?.text.endsWith("…")).toBe(true)
  expect(SessionGoalProgress.tasks(plan)).toEqual(original)
})
