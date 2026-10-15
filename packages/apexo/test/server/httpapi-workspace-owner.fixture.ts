// Set the child-owned database and global paths before importing any service graph.
const { cleanupExercisePaths } = await import("./httpapi-exercise/environment")
const { Effect, Duration } = await import("effect")
const { AppRuntime } = await import("../../src/effect/app-runtime")
const { http } = await import("./httpapi-exercise/dsl")
const { runScenario } = await import("./httpapi-exercise/runner")
const { TestLLMServer } = await import("../lib/llm-server")
const calls: string[] = []
const original = AppRuntime.runPromise
const descriptor = Object.getOwnPropertyDescriptor(AppRuntime, "runPromise")
if (!descriptor) throw new Error("Missing AppRuntime entrypoint descriptor")
// Observe the real runtime entrypoint without replacing any service behavior.
const observe: typeof AppRuntime.runPromise = (effect, options) => {
  calls.push(new Error().stack ?? "runtime invoked")
  return original(effect, options)
}
Object.defineProperty(AppRuntime, "runPromise", { value: observe, configurable: true })
try {
  const result = await Effect.runPromise(
    runScenario({
      mode: "effect",
      include: undefined,
      startAt: undefined,
      stopAt: undefined,
      trace: true,
      progress: false,
      scenarioTimeout: Duration.seconds(30),
      failOnMissing: false,
      failOnSkip: false,
    })(
      http.protected
        .post("/experimental/workspace/sync-list", "experimental.workspace.syncList")
        .status(204, undefined, "status"),
    ).pipe(Effect.provide(TestLLMServer.layer)),
  )
  if (result.status !== "pass") throw new Error(JSON.stringify(result))
  if (calls.length > 0)
    throw new Error(`Workspace adapter started a process-global database/cleanup owner: ${calls.join("\n")}`)
  console.log("WORKSPACE_OWNER_RELEASED")
} finally {
  Object.defineProperty(AppRuntime, "runPromise", descriptor)
  await AppRuntime.dispose()
  await Effect.runPromise(cleanupExercisePaths)
}
