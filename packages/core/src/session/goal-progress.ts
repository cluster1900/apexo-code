export * as SessionGoalProgress from "./goal-progress"

import { Goal } from "@apexo/schema/goal"

export type Task = { ordinal: number; text: string; completed: boolean }

/** Only the explicit immutable checklist assigns task identities; prose and fenced examples never do. */
export function tasks(plan: string | undefined): Task[] | undefined {
  if (!plan || Buffer.byteLength(plan) > 131_072) return
  const result: Task[] = []
  let level = 0
  let seen = false
  let fence: { character: string; length: number } | undefined
  for (const line of plan.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (marker) {
      if (!fence) {
        fence = { character: marker[1]![0]!, length: marker[1]!.length }
        continue
      }
      if (marker[1]![0] === fence.character && marker[1]!.length >= fence.length && !marker[2]!.trim())
        fence = undefined
      continue
    }
    if (fence) continue
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      if (heading[2]!.trim().toLowerCase() === "task checklist") {
        // A second checklist makes ordinal identity ambiguous; require one explicit section.
        if (seen) return
        seen = true
        level = heading[1]!.length
      } else if (level && heading[1]!.length <= level) level = 0
      continue
    }
    if (!level) continue
    const item = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line)
    if (!item) continue
    if (result.length === 128) return
    result.push({
      ordinal: result.length,
      text: item[2]!,
      completed: item[1] !== " ",
    })
  }
  return seen ? result : undefined
}

/** Validate durable annotations against their actual immutable plan, not only their wire shape. */
export function invalid(info: Pick<Goal.Info, "plan" | "planProgress">): string | undefined {
  if (!info.planProgress) return
  if (!info.plan?.trim()) return "Plan progress requires an original plan"
  const parsed = tasks(info.plan)
  if (info.planProgress.completed.length && !parsed) return "The plan has no supported task checklist"
  if (
    info.planProgress.completed.some(
      (ordinal, index, values) =>
        !Number.isInteger(ordinal) ||
        ordinal < 0 ||
        ordinal >= (parsed?.length ?? 0) ||
        (index > 0 && ordinal <= values[index - 1]!),
    )
  )
    return "Completed task ordinals must be valid, unique and sorted"
  if (info.planProgress.completed.length > 128) return "Too many completed tasks"
  if (info.planProgress.deviations.length > 16) return "At most 16 deviations are allowed"
  if (
    info.planProgress.deviations.some(
      (note, index, values) =>
        !note.trim() || note !== note.trim() || Buffer.byteLength(note) > 512 || values.indexOf(note) !== index,
    )
  )
    return "Deviations must be unique, trimmed and at most 512 UTF-8 bytes"
}

export function update(info: Pick<Goal.Info, "plan" | "planProgress">, patch: Goal.PlanProgressUpdate) {
  const corruption = invalid(info)
  if (corruption) return { error: corruption }
  if (!info.plan?.trim()) return { error: "Plan progress requires an original plan" }
  const parsed = tasks(info.plan)
  if (patch.complete?.length && !parsed) return { error: "The plan has no supported task checklist" }
  if (
    (patch.complete?.length ?? 0) > 128 ||
    patch.complete?.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= (parsed?.length ?? 0))
  )
    return { error: "Task ordinal is outside the original checklist" }
  const deviation = patch.deviation?.trim()
  if (patch.deviation !== undefined && (!deviation || Buffer.byteLength(deviation) > 512))
    return { error: "Deviation must contain 1 to 512 UTF-8 bytes" }
  const completed = [
    ...new Set([
      ...(info.planProgress?.completed ?? []),
      ...(parsed?.filter((task) => task.completed).map((task) => task.ordinal) ?? []),
      ...(patch.complete ?? []),
    ]),
  ].sort((a, b) => a - b)
  const deviations = [...new Set([...(info.planProgress?.deviations ?? []), ...(deviation ? [deviation] : [])])]
  if (deviations.length > 16) return { error: "At most 16 deviations are allowed" }
  const before = info.planProgress ?? {
    completed: parsed?.filter((task) => task.completed).map((task) => task.ordinal) ?? [],
    deviations: [],
  }
  if (JSON.stringify(before) === JSON.stringify({ completed, deviations })) return { value: info.planProgress }
  return { value: { completed, deviations } }
}

/** Annotations are work notes, never completion evidence or replacement acceptance criteria. */
export function context(info: Pick<Goal.Info, "plan" | "planProgress">) {
  const parsed = tasks(info.plan)
  return {
    advisory: true,
    tasks:
      parsed?.map((task) => ({
        ...task,
        text: [...task.text].length > 128 ? [...task.text].slice(0, 128).join("") + "…" : task.text,
        completed: task.completed || !!info.planProgress?.completed.includes(task.ordinal),
      })) ?? [],
    deviations: info.planProgress?.deviations ?? [],
  }
}

export function next(info: Pick<Goal.Info, "plan" | "planProgress">) {
  return context(info).tasks.find((task) => !task.completed)?.text
}
