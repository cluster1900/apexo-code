export * as Computer from "./computer"

import { Computer as ComputerSchema } from "@apexo/schema/computer"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Database } from "./database/database"
import { EventV2, latestSequence, readAggregate } from "./event"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { makeLocationNode } from "./effect/app-node"
import { AppProcess } from "./process"

const MAX_TEXT = 12_000
const FIXTURE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

export class ComputerError extends Schema.TaggedErrorClass<ComputerError>()("Computer.Error", {
  code: Schema.Literals(["unsupported_platform", "permission_required", "unavailable", "invalid_action", "stale_target", "session_not_found", "artifact_error"]),
  message: Schema.String,
}) {}

type State = { info: ComputerSchema.Info; driver: "native" | "fixture" }
type ActionOutput = {
  readonly output: string
  readonly snapshot?: ComputerSchema.Snapshot
  readonly artifact?: ComputerSchema.Artifact
  readonly artifactData?: string
}

export interface Interface {
  readonly list: () => Effect.Effect<ComputerSchema.Info[]>
  readonly open: (input: ComputerSchema.OpenInput) => Effect.Effect<ComputerSchema.Info, ComputerError>
  readonly act: (
    input: Omit<ComputerSchema.ActionInput, "computerSessionID"> & { readonly computerSessionID: ComputerSchema.ComputerSessionID },
  ) => Effect.Effect<{ readonly computerSessionID: ComputerSchema.ComputerSessionID; readonly actionID: ComputerSchema.ActionID } & ActionOutput, ComputerError>
  readonly close: (computerSessionID: ComputerSchema.ComputerSessionID) => Effect.Effect<void, ComputerError>
  readonly replay: (input: {
    readonly computerSessionID: ComputerSchema.ComputerSessionID
    readonly after?: number
    readonly limit: number
  }) => Effect.Effect<ComputerSchema.ReplayPage, ComputerError>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/Computer") {}

const publish = (events: EventV2.Interface, definition: EventV2.Definition, data: unknown) =>
  events.publish(definition as never, data as never).pipe(Effect.asVoid, Effect.catch(() => Effect.void))

const outputText = (result: { readonly stdout: Uint8Array; readonly stderr: Uint8Array }) =>
  Buffer.from(result.stdout).toString("utf8").trim() || Buffer.from(result.stderr).toString("utf8").trim()

const snapshotHash = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16)
}

const fixture = () =>
  ComputerSchema.Snapshot.make({
    hash: snapshotHash("Fixture App|Fixture Window|Close button"),
    activeApp: "Fixture App",
    window: "Fixture Window",
    text: "Close button",
  })

const nativeScript = `tell application "System Events"
set frontProcess to first process whose frontmost is true
set appName to name of frontProcess
set windowName to ""
try
  set windowName to name of first window of frontProcess
end try
return appName & "|" & windowName
end tell`

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const sessions = new Map<ComputerSchema.ComputerSessionID, State>()
    const fixtureMode = process.env.APEXO_COMPUTER_BACKEND === "fixture"

    const run = (command: string, args: ReadonlyArray<string>) =>
      appProcess.run(ChildProcess.make(command, [...args])).pipe(
        Effect.mapError((error) => {
          const message = error.message
          const code = /not permitted|accessibility|assistive|permission|not authorized/iu.test(message)
            ? "permission_required"
            : "unavailable"
          return new ComputerError({ code, message })
        }),
      )

    const observe = Effect.fn("Computer.observe")(function* (useFixture = fixtureMode) {
      const available = process.platform === "darwin" || useFixture
      if (!available)
        return yield* new ComputerError({ code: "unsupported_platform", message: "Computer Use currently supports macOS only." })
      if (useFixture) return fixture()
      const result = yield* run("/usr/bin/osascript", ["-e", nativeScript])
      const [activeApp, window] = outputText(result).split("|", 2)
      const text = `${activeApp ?? ""} ${window ?? ""}`.trim().slice(0, MAX_TEXT)
      return ComputerSchema.Snapshot.make({
        hash: snapshotHash(text),
        ...(activeApp ? { activeApp } : {}),
        ...(window ? { window } : {}),
        ...(text ? { text } : {}),
      })
    })

    const runCliclick = (args: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const result = yield* run("/usr/bin/which", ["cliclick"])
        const executable = outputText(result)
        if (!executable) return yield* new ComputerError({ code: "unavailable", message: "cliclick is not installed." })
        return yield* run(executable, args)
      })

    const capture = Effect.fn("Computer.capture")(function* (sessionID: ComputerSchema.ComputerSessionID, useFixture = fixtureMode) {
      const artifactID = ComputerSchema.ArtifactID.create()
      const relativePath = `.apexo/computer/${sessionID}/${artifactID}.png`
      const absolutePath = `${location.directory}/${relativePath}`
      const bytes = useFixture
        ? Buffer.from(FIXTURE_PNG, "base64")
        : yield* fs.ensureDir(`${location.directory}/.apexo/computer/${sessionID}`).pipe(
            Effect.mapError((error) => new ComputerError({ code: "artifact_error", message: String(error) })),
            Effect.andThen(run("/usr/sbin/screencapture", ["-x", "-C", "-t", "png", absolutePath])),
            Effect.andThen(fs.readFile(absolutePath)),
            Effect.mapError((error) =>
              error instanceof ComputerError
                ? error
                : new ComputerError({ code: "artifact_error", message: `Unable to capture the desktop: ${String(error)}` }),
            ),
          )
      if (useFixture) yield* fs.writeWithDirs(absolutePath, bytes).pipe(Effect.mapError((error) => new ComputerError({ code: "artifact_error", message: String(error) })))
      const artifact = ComputerSchema.Artifact.make({
        id: artifactID,
        mime: "image/png",
        relativePath,
        byteLength: bytes.byteLength,
        sensitive: true,
      })
      return { artifact, artifactData: Buffer.from(bytes).toString("base64") }
    })

    const update = (state: State, patch: Partial<ComputerSchema.Info>) => {
      state.info = ComputerSchema.Info.make({ ...state.info, ...patch })
      return state.info
    }

    const open = Effect.fn("Computer.open")(function* (input: ComputerSchema.OpenInput) {
      const computerSessionID = ComputerSchema.ComputerSessionID.create()
      const useFixture = fixtureMode && input.backend !== "native"
      const available = process.platform === "darwin" || useFixture
      const status = available ? "ready" : "unavailable"
      const info = ComputerSchema.Info.make({
        id: computerSessionID,
        sessionID: input.sessionID,
        status,
        backend: useFixture ? "fixture" : process.platform === "darwin" ? "macos-accessibility" : "unsupported",
        createdAt: Date.now(),
        ...(available ? {} : { unavailableReason: "Computer Use currently supports macOS only." }),
      })
      const state = { info, driver: useFixture ? "fixture" : "native" } satisfies State
      sessions.set(computerSessionID, state)
      if (available) {
        const snapshot = yield* observe(useFixture).pipe(
          Effect.catchTag("Computer.Error", (error) => {
            update(state, { status: error.code === "permission_required" ? "permission_required" : "unavailable", unavailableReason: error.message })
            return Effect.succeed(undefined)
          }),
        )
        if (snapshot) update(state, { snapshot, status: "ready", lastActionAt: Date.now() })
      }
      yield* publish(events, ComputerSchema.Event.Started, { computerSessionID, sessionID: input.sessionID, info: state.info })
      return state.info
    })

    const act = Effect.fn("Computer.act")(function* (
      input: Omit<ComputerSchema.ActionInput, "computerSessionID"> & { readonly computerSessionID: ComputerSchema.ComputerSessionID },
    ) {
      const state = sessions.get(input.computerSessionID)
      if (!state) return yield* new ComputerError({ code: "session_not_found", message: "Computer session not found" })
      const actionID = ComputerSchema.ActionID.create()
      yield* publish(events, ComputerSchema.Event.ActionStarted, { computerSessionID: input.computerSessionID, actionID, action: input.action })
      const output = yield* Effect.gen(function* () {
        if (input.action === "close") {
          yield* close(input.computerSessionID)
          return { output: "Computer session closed" }
        }
        const useFixture = state.driver === "fixture"
        const available = process.platform === "darwin" || useFixture
        if (!available) return yield* new ComputerError({ code: "unsupported_platform", message: "Computer Use currently supports macOS only." })
        if (input.expectedSnapshotHash && state.info.snapshot?.hash !== input.expectedSnapshotHash)
          return yield* new ComputerError({ code: "stale_target", message: "The desktop changed; observe it again before acting." })
        if (input.action === "observe") {
          const snapshot = yield* observe(useFixture)
          return { output: JSON.stringify(snapshot), snapshot }
        }
        if (input.action === "screenshot") {
          const snapshot = yield* observe(useFixture)
          const artifact = yield* capture(input.computerSessionID, useFixture)
          yield* publish(events, ComputerSchema.Event.ArtifactCreated, { computerSessionID: input.computerSessionID, artifact: artifact.artifact })
          return { output: `Screenshot saved as ${artifact.artifact.relativePath}`, snapshot, ...artifact }
        }
        if (input.action === "click") {
          if (input.x === undefined || input.y === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.click requires x and y" })
          if (!useFixture) yield* runCliclick([`c:${input.x},${input.y}`])
          return { output: `Clicked ${input.x},${input.y}`, snapshot: yield* observe(useFixture) }
        }
        if (input.action === "type") {
          if (input.text === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.type requires text" })
          if (!useFixture) yield* runCliclick([`t:${input.text}`])
          return { output: "Typed text", snapshot: yield* observe(useFixture) }
        }
        if (input.action === "press") {
          if (!input.key) return yield* new ComputerError({ code: "invalid_action", message: "computer.press requires key" })
          if (!useFixture) yield* runCliclick([`kp:${input.key}`])
          return { output: `Pressed ${input.key}`, snapshot: yield* observe(useFixture) }
        }
        if (input.action === "scroll") {
          if (input.y === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.scroll requires y" })
          if (!useFixture) yield* runCliclick([`kp:${input.y > 0 ? "page-down" : "page-up"}`])
          return { output: `Scrolled ${input.y}`, snapshot: yield* observe(useFixture) }
        }
        return yield* new ComputerError({ code: "invalid_action", message: `Unsupported computer action: ${input.action}` })
      }).pipe(
        Effect.tap((result) => {
          update(state, { snapshot: result.snapshot, lastActionAt: Date.now(), status: "ready", unavailableReason: undefined })
          return publish(events, ComputerSchema.Event.ActionCompleted, {
            computerSessionID: input.computerSessionID,
            actionID,
            action: input.action,
            status: "completed",
            output: result.output,
            ...(result.snapshot ? { snapshot: result.snapshot } : {}),
            ...(("artifact" in result && result.artifact) ? { artifactID: result.artifact.id } : {}),
          })
        }),
        Effect.tapError((error) => publish(events, ComputerSchema.Event.ActionCompleted, {
          computerSessionID: input.computerSessionID,
          actionID,
          action: input.action,
          status: "failed",
          error: error.message,
        })),
      )
      return { actionID, action: input.action, computerSessionID: input.computerSessionID, ...output }
    })

    const close = Effect.fn("Computer.close")(function* (computerSessionID: ComputerSchema.ComputerSessionID) {
      const state = sessions.get(computerSessionID)
      if (!state) return
      update(state, { status: "closed", lastActionAt: Date.now() })
      yield* publish(events, ComputerSchema.Event.Closed, { computerSessionID })
      sessions.delete(computerSessionID)
    })

    const replay = Effect.fn("Computer.replay")(function* (input: { readonly computerSessionID: ComputerSchema.ComputerSessionID; readonly after?: number; readonly limit: number }) {
      const limit = Math.min(Math.max(input.limit, 1), 100)
      const page = yield* readAggregate(database.db, {
        aggregateID: input.computerSessionID,
        after: input.after,
        limit,
        manifest: {
          definitions: new Map(ComputerSchema.Event.Definitions.map((definition) => [`${definition.type}.${definition.durable?.version ?? 0}`, definition])),
          schema: ComputerSchema.Events,
        },
      }).pipe(Effect.mapError((cause) => new ComputerError({ code: "unavailable", message: String(cause) })))
      const head = yield* latestSequence(database.db, input.computerSessionID)
      const first = page.events[0]?.durable?.seq ?? input.after ?? 0
      return ComputerSchema.ReplayPage.make({ events: page.events, cursor: { earliest: first, head, ...(page.hasMore && page.events.at(-1)?.durable ? { next: String(page.events.at(-1)!.durable!.seq) } : {}) } })
    })

    return Service.of({ list: () => Effect.sync(() => [...sessions.values()].map((state) => state.info)), open, act, close, replay })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Location.node, FSUtil.node, Database.node, EventV2.node, AppProcess.node] })
