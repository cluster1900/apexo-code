// Runs only in a short-lived Bun child with the fixture's isolated environment.
import { Effect } from "effect"
import { SchedulerStore } from "@apexo/core/scheduler-store"
const input = JSON.parse(process.argv[2])
const records = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const store = yield* SchedulerStore.make(input.directory)
  if (input.save) for (const record of input.save) yield* store.save(record)
  return yield* store.load()
})))
console.log(`SCHEDULER_STORE_RESULT ${JSON.stringify(records)}`)
