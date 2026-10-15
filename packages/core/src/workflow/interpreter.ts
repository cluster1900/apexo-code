export * as WorkflowInterpreter from "./interpreter"

import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, FileSystem, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "../process"
import { WorkflowStore } from "./store"

export function executable(filesystem: FileSystem.FileSystem) {
  return Effect.gen(function* () {
    const name = `apexo-workflow-script${process.platform === "win32" ? ".exe" : ""}`
    const paths = process.env.APEXO_WORKFLOW_SCRIPT
      ? [process.env.APEXO_WORKFLOW_SCRIPT]
      : [
          path.join(path.dirname(process.execPath), name),
          fileURLToPath(new URL(`../../../workflow-script/target/release/${name}`, import.meta.url)),
        ]
    const available = yield* Effect.filter(paths, (file) => filesystem.exists(file))
    if (!available[0])
      return yield* new WorkflowStore.Failure({
        code: "invalid",
        message: "Apexo workflow script interpreter is not installed",
      })
    return available[0]
  })
}

export function validate(processes: AppProcess.Interface, filesystem: FileSystem.FileSystem, script: string) {
  return Effect.gen(function* () {
    const file = yield* executable(filesystem)
    const result = yield* processes.run(ChildProcess.make(file, []), {
      stdin: `${JSON.stringify({ version: 1, script, validate: true })}\n`,
      maxOutputBytes: 64_000,
      maxErrorBytes: 16_000,
      timeout: "10 seconds",
    })
    if (result.stdoutTruncated)
      return yield* new WorkflowStore.Failure({
        code: "invalid",
        message: "Workflow validation output exceeded its limit",
      })
    const reply = yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(
      result.stdout.toString("utf8").trim(),
    ).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.Struct({ type: Schema.String, message: Schema.optional(Schema.String) })),
      ),
    )
    if (reply.type === "validated" && result.exitCode === 0) return { valid: true, diagnostics: [] as string[] }
    if (reply.type === "error") return { valid: false, diagnostics: [reply.message ?? "Invalid Rhai script"] }
    return yield* new WorkflowStore.Failure({ code: "invalid", message: "Unexpected workflow validation protocol" })
  }).pipe(
    Effect.mapError((error) =>
      error instanceof WorkflowStore.Failure
        ? error
        : new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
    ),
  )
}
