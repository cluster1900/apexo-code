import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { BackgroundJob as CoreBackgroundJob } from "@apexo/core/background-job"
import { Database } from "@apexo/core/database/database"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer } from "effect"
import type { SessionID } from "@/session/schema"
import { BackgroundTask } from "@apexo/schema/background-task"

export {
  Service,
  type ExtendInput,
  type Info,
  type Interface,
  type ResumeInput,
  type StartInput,
  type Status,
  type WaitInput,
  type WaitResult,
} from "@apexo/core/background-job"

/** Keeps the legacy service instance-scoped while sharing the core registry engine. */
const layer = Layer.effect(
  CoreBackgroundJob.Service,
  Effect.gen(function* () {
    const lifecycle = yield* SessionLifecycle.Service
    const database = yield* Database.Service
    const state = yield* InstanceState.make(() =>
      CoreBackgroundJob.makeOwnedDurable.pipe(
        Effect.provideService(SessionLifecycle.Service, lifecycle),
        Effect.provideService(Database.Service, database),
      ),
    )
    return CoreBackgroundJob.Service.of({
      list: () => InstanceState.useEffect(state, (jobs) => jobs.list()),
      get: (id) => InstanceState.useEffect(state, (jobs) => jobs.get(id)),
      start: (input) => InstanceState.useEffect(state, (jobs) => jobs.start(input)),
      report: (input) => InstanceState.useEffect(state, (jobs) => jobs.report(input)),
      extend: (input) => InstanceState.useEffect(state, (jobs) => jobs.extend(input)),
      wait: (input) => InstanceState.useEffect(state, (jobs) => jobs.wait(input)),
      waitForPromotion: (id) => InstanceState.useEffect(state, (jobs) => jobs.waitForPromotion(id)),
      promote: (id) => InstanceState.useEffect(state, (jobs) => jobs.promote(id)),
      cancel: (id) => InstanceState.useEffect(state, (jobs) => jobs.cancel(id)),
      resume: (input) => InstanceState.useEffect(state, (jobs) => jobs.resume(input)),
    })
  }),
)

export const node = LayerNode.make({
  service: CoreBackgroundJob.Service,
  layer,
  deps: [SessionLifecycle.node, Database.node],
})

export function owns(job: CoreBackgroundJob.Info, sessionID: string) {
  return job.metadata?.ownerSessionId === sessionID || job.metadata?.parentSessionId === sessionID
}

/** Only expose task presentation fields, never saved provider or recovery context. */
export function summary(job: CoreBackgroundJob.Info, sessionID: string): BackgroundTask.Summary {
  return {
    id: job.id,
    type: job.type,
    title: job.title,
    status: job.status,
    started_at: job.started_at,
    completed_at: job.completed_at,
    sessionID,
    childSessionID: typeof job.metadata?.sessionId === "string" ? job.metadata.sessionId : undefined,
    nextFireAt: typeof job.metadata?.nextFireAt === "number" ? job.metadata.nextFireAt : undefined,
    background: job.metadata?.background === true || job.type === "monitor" || job.type === "scheduler",
  }
}

export const promoteSession = Effect.fn("BackgroundJob.promoteSession")(function* (
  background: CoreBackgroundJob.Interface,
  sessionID: SessionID,
  subagents: boolean,
) {
  const jobs = (yield* background.list()).filter(
    (job) =>
      job.status === "running" &&
      job.metadata?.background !== true &&
      ((job.type === "shell" && job.metadata?.ownerSessionId === sessionID && job.metadata.foreground === true) ||
        (subagents && job.type === "task" && job.metadata?.parentSessionId === sessionID)),
  )
  const promoted = yield* Effect.forEach(jobs, (job) => background.promote(job.id), { concurrency: "unbounded" })
  return promoted.some((job) => job?.status === "running" && job.metadata?.background === true)
})

export * as BackgroundJob from "./job"
