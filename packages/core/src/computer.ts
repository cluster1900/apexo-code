export * as Computer from "./computer"

import type { CuaLike, SandboxLike, SpacesdClientLike } from "@trycua/cua"
import type { ActionResult, CuaDriverLike, ToolResult } from "@trycua/cua-driver"
import { Computer as ComputerSchema } from "@apexo/schema/computer"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database"
import { EventV2, latestSequence, readAggregate } from "./event"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { makeLocationNode } from "./effect/app-node"

const MAX_TEXT = 12_000
const FIXTURE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

export class ComputerError extends Schema.TaggedErrorClass<ComputerError>()("Computer.Error", {
  code: Schema.Literals(["unsupported_platform", "permission_required", "unavailable", "invalid_action", "stale_target", "session_not_found", "artifact_error"]),
  message: Schema.String,
}) {}

type FixtureState = { activeApp: string; window: string; text: string }
type Runtime =
  | { readonly kind: "cua"; readonly driver: CuaDriverLike; readonly reader: CuaDriverLike; readonly session: string; readonly readerSession: string }
  | { readonly kind: "lume"; readonly cua: CuaLike; readonly sandbox: SandboxLike; readonly spacesd: SpacesdClientLike; readonly session: string }
type State = { info: ComputerSchema.Info; runtime?: Runtime; fixture: FixtureState }
type Observation = { readonly snapshot: ComputerSchema.Snapshot; readonly image?: string; readonly captureID?: string; readonly windowTarget?: { readonly pid: number; readonly windowId: bigint } }
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

const asError = (cause: unknown) => (cause instanceof globalThis.Error ? cause : new globalThis.Error(String(cause)))

const errorFromCause = (cause: unknown) => {
  const message = asError(cause).message
  const code = /permission|accessibility|screen recording|not authorized|tcc/iu.test(message) ? "permission_required" : "unavailable"
  return new ComputerError({ code, message })
}

const providerActionAssessment = (result: ActionResult | ToolResult, action: string, effects: { readonly confirmed: number; readonly partial: number; readonly unverifiable: number }) => {
  const evidence = "effect" in result ? result : result.action
  if (evidence && (evidence.effect === effects.confirmed || evidence.effect === effects.partial)) return undefined
  if (evidence?.effect === effects.unverifiable) return { uncertain: true as const }
  const message = evidence && "error" in evidence ? evidence.error?.hint : undefined
  const hint = evidence && "hint" in evidence ? evidence.hint : undefined
  const summary = evidence && "summary" in evidence ? evidence.summary : undefined
  return { failure: new ComputerError({ code: "unavailable", message: message ?? hint ?? summary ?? ("text" in result ? result.text : `Cua Driver did not confirm ${action}.`) }) }
}

const snapshotHash = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16)
}

const fixture = (state: FixtureState) =>
  ComputerSchema.Snapshot.make({
    hash: snapshotHash(`${state.activeApp}|${state.window}|${state.text}`),
    activeApp: state.activeApp,
    window: state.window,
    text: state.text,
  })

const runtimeLabel = (runtime: Runtime) => (runtime.kind === "cua" ? "cua-driver" : "lume")

const captureID = (structuredJson: string | undefined) => {
  if (!structuredJson) return undefined
  try {
    const value: unknown = JSON.parse(structuredJson)
    if (typeof value !== "object" || value === null || !("capture_id" in value) || typeof value.capture_id !== "string") return undefined
    return value.capture_id
  } catch {
    return undefined
  }
}

const observeRuntime = async (runtime: Runtime): Promise<Observation> => {
  if (runtime.kind === "cua") {
    const desktop = await runtime.driver.getDesktopState({ session: runtime.session, maxImageDimension: 1600 })
    if (desktop.isError) throw new globalThis.Error(desktop.text || "Cua Driver could not observe the desktop")
    const windows = await runtime.driver.listWindows({ onScreenOnly: true })
    const front = windows.windows.filter((window) => window.bounds.width >= 200 && window.bounds.height >= 100).reduce<typeof windows.windows[number] | undefined>((current, candidate) => {
      if (!current) return candidate
      if (candidate.zIndex === undefined) return current
      if (current.zIndex === undefined || candidate.zIndex > current.zIndex) return candidate
      return current
    }, undefined)
    const windowState = front?.pid === undefined ? undefined : await runtime.reader.getWindowState({ session: runtime.readerSession, pid: front.pid, windowId: front.windowId, includeAccessibilityTree: true, maxImageDimension: 1600, treeFormat: "markdown" }).catch(() => undefined)
    const windowText = windowState?.treeMarkdown ?? ""
    const text = `${desktop.text}${windowText ? `\n${windowText}` : ""}`.slice(0, MAX_TEXT)
    const identity = `${front?.appName ?? ""}|${front?.title ?? ""}|${text}`
    const image = desktop.images[0]?.dataBase64
    return {
      snapshot: ComputerSchema.Snapshot.make({
        hash: snapshotHash(identity),
        ...(front?.appName ? { activeApp: front.appName } : {}),
        ...(front?.title ? { window: front.title } : {}),
        ...(text ? { text } : {}),
      }),
      image,
      captureID: captureID(desktop.structuredJson),
      ...(front?.pid === undefined ? {} : { windowTarget: { pid: front.pid, windowId: front.windowId } }),
    }
  }
  const screenshot = await runtime.spacesd.screenshot({ includeCursor: false })
  const text = `Lume desktop ${runtime.sandbox.name()}`.slice(0, MAX_TEXT)
  const image = Buffer.from(screenshot.image).toString("base64")
  return {
    snapshot: ComputerSchema.Snapshot.make({ hash: snapshotHash(text), activeApp: "Lume", window: runtime.sandbox.name(), text }),
    image,
  }
}

const openRuntime = async (kind: "cua" | "lume", session: string): Promise<Runtime> => {
  if (kind === "cua") {
    const { CuaDriver, CaptureScope } = await import("@trycua/cua-driver")
    const driver = CuaDriver.create({ embedded: true, claudeCodeCompatibility: false })
    if (!driver.isAvailable()) throw new globalThis.Error("Cua Driver is unavailable or macOS permissions are missing")
    try {
      await driver.startSession({ session, captureScope: CaptureScope.Desktop })
      const reader = CuaDriver.create({ embedded: true, claudeCodeCompatibility: false })
      const readerSession = `${session}:reader`
      try {
        await reader.startSession({ session: readerSession, captureScope: CaptureScope.Auto })
        return { kind, driver, reader, session, readerSession }
      } catch (error) {
        await reader.shutdown().catch(() => undefined)
        throw error
      }
    } catch (error) {
      await driver.shutdown().catch(() => undefined)
      throw error
    }
  }
  if (process.platform !== "darwin") throw new globalThis.Error("Lume Computer Use currently requires macOS")
  if (!Bun.which("lume")) throw new globalThis.Error("Lume is not installed; install the Lume runtime before selecting isolated Computer Use")
  const { embedded, Image, ReadinessProbe, SandboxCreateOptions } = await import("@trycua/cua")
  const cua = embedded()
  const sandbox = await cua.sandboxes().create(
    SandboxCreateOptions.create({
      on: "local",
      kind: "vm",
      runtime: "lume",
      image: process.env.APEXO_LUME_IMAGE ?? Image.macos(),
      ports: [],
      services: new Map([["env", 3211]]),
      waitFor: [ReadinessProbe.create({ service: "env", port: 0, httpPath: "/health", httpStatus: 204 })],
      env: new Map(),
      sidecars: [],
      overlays: [],
      keepOnFailure: false,
      headless: false,
    }),
  )
  try {
    const spacesd = await sandbox.spacesd(30_000)
    return { kind, cua, sandbox, spacesd, session }
  } catch (error) {
    await sandbox.delete_().catch(() => undefined)
    throw error
  }
}

const closeRuntime = async (runtime: Runtime) => {
  if (runtime.kind === "cua") {
    await runtime.reader.endSession({ session: runtime.readerSession })
    await runtime.reader.shutdown()
    await runtime.driver.endSession({ session: runtime.session })
    await runtime.driver.shutdown()
    return
  }
  await runtime.sandbox.delete_()
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const sessions = new Map<ComputerSchema.ComputerSessionID, State>()
    const fixtureMode = process.env.APEXO_COMPUTER_BACKEND === "fixture"
    const requestedRuntime = process.env.APEXO_COMPUTER_RUNTIME === "lume" ? "lume" : "cua"

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        [...sessions.values()],
        (state) => state.runtime ? Effect.promise(() => closeRuntime(state.runtime!)).pipe(Effect.ignore) : Effect.void,
        { discard: true },
      ).pipe(Effect.andThen(Effect.sync(() => sessions.clear()))),
    )

    const observe = Effect.fn("Computer.observe")(function* (state: State) {
      if (state.runtime) return yield* Effect.tryPromise({ try: () => observeRuntime(state.runtime!), catch: errorFromCause })
      if (fixtureMode) return { snapshot: fixture(state.fixture), image: FIXTURE_PNG }
      return yield* new ComputerError({ code: "unavailable", message: "Computer Use runtime is unavailable." })
    })

    const capture = Effect.fn("Computer.capture")(function* (sessionID: ComputerSchema.ComputerSessionID, observation: Observation) {
      const data = observation.image
      if (!data) return yield* new ComputerError({ code: "artifact_error", message: "Computer provider did not return a screenshot." })
      const artifactID = ComputerSchema.ArtifactID.create()
      const relativePath = `.apexo/computer/${sessionID}/${artifactID}.png`
      const bytes = Buffer.from(data, "base64")
      yield* fs.writeWithDirs(`${location.directory}/${relativePath}`, bytes).pipe(
        Effect.mapError((cause) => new ComputerError({ code: "artifact_error", message: `Unable to save screenshot: ${cause}` })),
      )
      return {
        artifact: ComputerSchema.Artifact.make({ id: artifactID, mime: "image/png", relativePath, byteLength: bytes.byteLength, sensitive: true }),
        artifactData: data,
      }
    })

    const update = (state: State, patch: Partial<ComputerSchema.Info>) => {
      state.info = ComputerSchema.Info.make({ ...state.info, ...patch })
      return state.info
    }

    const close = Effect.fn("Computer.close")(function* (computerSessionID: ComputerSchema.ComputerSessionID) {
      const state = sessions.get(computerSessionID)
      if (!state) return
      const runtime = state.runtime
      state.runtime = undefined
      sessions.delete(computerSessionID)
      if (runtime) yield* Effect.tryPromise({ try: () => closeRuntime(runtime), catch: errorFromCause }).pipe(Effect.ignore)
      update(state, { status: "closed", lastActionAt: Date.now() })
      yield* publish(events, ComputerSchema.Event.Closed, { computerSessionID })
    })

    const open = Effect.fn("Computer.open")(function* (input: ComputerSchema.OpenInput) {
      const computerSessionID = ComputerSchema.ComputerSessionID.create()
      const useFixture = fixtureMode && input.backend !== "native"
      const state: State = {
        info: ComputerSchema.Info.make({
          id: computerSessionID,
          sessionID: input.sessionID,
          status: useFixture ? "ready" : "unavailable",
          backend: useFixture ? "fixture" : requestedRuntime === "lume" ? "lume" : "cua-driver",
          createdAt: Date.now(),
          ...(useFixture ? {} : { unavailableReason: "Starting the third-party Computer Use provider." }),
        }),
        fixture: { activeApp: "Fixture App", window: "Fixture Window", text: "Close button" },
      }
      sessions.set(computerSessionID, state)
      if (!useFixture) {
        const runtimePromise = openRuntime(requestedRuntime, String(computerSessionID))
        const result = yield* Effect.tryPromise({ try: () => runtimePromise, catch: errorFromCause }).pipe(
          Effect.timeoutOrElse({
            duration: Number(process.env.APEXO_COMPUTER_RUNTIME_TIMEOUT_MS ?? 45_000),
            orElse: () => Effect.fail(new ComputerError({ code: "unavailable", message: `Timed out starting the ${requestedRuntime} Computer Use provider.` })),
          }),
          Effect.result,
        )
        if (result._tag === "Success") {
          state.runtime = result.success
          const observation = yield* observe(state).pipe(
            Effect.tapError(() => Effect.promise(() => closeRuntime(state.runtime!).catch(() => undefined))),
            Effect.tapError(() => Effect.sync(() => {
              state.runtime = undefined
              sessions.delete(computerSessionID)
            })),
          )
          update(state, { snapshot: observation.snapshot, status: "ready", lastActionAt: Date.now(), unavailableReason: undefined })
        }
        if (result._tag === "Failure") {
          void runtimePromise.then((runtime) => closeRuntime(runtime).catch(() => undefined)).catch(() => undefined)
          const failure = result.failure
          update(state, { status: failure.code === "permission_required" ? "permission_required" : "unavailable", unavailableReason: failure.message })
        }
      } else update(state, { snapshot: fixture(state.fixture), lastActionAt: Date.now() })
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
        if (input.expectedSnapshotHash && state.info.snapshot?.hash !== input.expectedSnapshotHash)
          return yield* new ComputerError({ code: "stale_target", message: "The desktop changed; observe it again before acting." })
        if (!state.runtime && !fixtureMode) return yield* new ComputerError({ code: "unavailable", message: state.info.unavailableReason ?? "Computer Use runtime is unavailable." })
        if (input.action === "observe") {
          const observation = yield* observe(state)
          return { output: JSON.stringify(observation.snapshot), snapshot: observation.snapshot }
        }
        if (input.action === "screenshot") {
          const observation = yield* observe(state)
          const artifact = yield* capture(input.computerSessionID, observation)
          yield* publish(events, ComputerSchema.Event.ArtifactCreated, { computerSessionID: input.computerSessionID, artifact: artifact.artifact })
          return { output: `Screenshot saved as ${artifact.artifact.relativePath}`, snapshot: observation.snapshot, ...artifact }
        }
        const runtime = state.runtime
        let providerUnverified = false
        const before = runtime?.kind === "cua" ? yield* observe(state) : undefined
        if (runtime?.kind === "cua") {
          const { ActionEffect, ActionTarget, ClickPosition, InputDeliveryMode, ScrollBy, ScrollDirection } = yield* Effect.tryPromise({ try: () => import("@trycua/cua-driver"), catch: errorFromCause })
          const target = new ActionTarget.Desktop({ displayId: "primary" })
          const windowTarget = before?.windowTarget ? new ActionTarget.Window(before.windowTarget) : target
          const capturedPosition = (x: number, y: number) => before?.captureID ? new ClickPosition.CapturedCoordinates({ x, y, captureId: before.captureID }) : new ClickPosition.Coordinates({ x, y })
          if (input.action === "click") {
            if (input.x === undefined || input.y === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.click requires x and y" })
            const result = yield* Effect.tryPromise({
              try: () => runtime.driver.click({ target, position: capturedPosition(input.x!, input.y!), deliveryMode: InputDeliveryMode.Foreground, session: runtime.session }),
              catch: errorFromCause,
            })
            const assessment = providerActionAssessment(result, input.action, { confirmed: ActionEffect.Confirmed, partial: ActionEffect.Partial, unverifiable: ActionEffect.Unverifiable })
            if (assessment?.failure) return yield* assessment.failure
            providerUnverified = assessment?.uncertain === true
          }
          if (input.action === "type") {
            if (input.text === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.type requires text" })
            const result = yield* Effect.tryPromise({ try: () => runtime.reader.typeText({ text: input.text!, target: windowTarget, session: runtime.readerSession }), catch: errorFromCause })
            const assessment = providerActionAssessment(result, input.action, { confirmed: ActionEffect.Confirmed, partial: ActionEffect.Partial, unverifiable: ActionEffect.Unverifiable })
            if (assessment?.failure) return yield* assessment.failure
            providerUnverified = assessment?.uncertain === true
          }
          if (input.action === "press") {
            if (!input.key) return yield* new ComputerError({ code: "invalid_action", message: "computer.press requires key" })
            const result = yield* Effect.tryPromise({ try: () => runtime.reader.pressKey({ key: input.key!, target: windowTarget, session: runtime.readerSession }), catch: errorFromCause })
            const assessment = providerActionAssessment(result, input.action, { confirmed: ActionEffect.Confirmed, partial: ActionEffect.Partial, unverifiable: ActionEffect.Unverifiable })
            if (assessment?.failure) return yield* assessment.failure
            providerUnverified = assessment?.uncertain === true
          }
          if (input.action === "scroll") {
            if (input.y === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.scroll requires y" })
            const result = yield* Effect.tryPromise({
              try: () => runtime.reader.scroll({ x: input.x ?? 0, y: input.y!, direction: input.y! >= 0 ? ScrollDirection.Down : ScrollDirection.Up, by: ScrollBy.Line, amount: BigInt(Math.abs(input.y!)), target: windowTarget, session: runtime.readerSession }),
              catch: errorFromCause,
            })
            const assessment = providerActionAssessment(result, input.action, { confirmed: ActionEffect.Confirmed, partial: ActionEffect.Partial, unverifiable: ActionEffect.Unverifiable })
            if (assessment?.failure) return yield* assessment.failure
            providerUnverified = assessment?.uncertain === true
          }
        } else if (runtime?.kind === "lume") {
          if (input.action === "click") {
            if (input.x === undefined || input.y === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.click requires x and y" })
            yield* Effect.tryPromise({ try: () => runtime.spacesd.click(input.x!, input.y!), catch: errorFromCause })
          }
          if (input.action === "type") {
            if (input.text === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.type requires text" })
            yield* Effect.tryPromise({ try: () => runtime.spacesd.typeText(input.text!), catch: errorFromCause })
          }
          if (input.action === "press") {
            if (!input.key) return yield* new ComputerError({ code: "invalid_action", message: "computer.press requires key" })
            yield* Effect.tryPromise({ try: () => runtime.spacesd.press(input.key!), catch: errorFromCause })
          }
          if (input.action === "scroll") {
            if (input.y === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.scroll requires y" })
            yield* Effect.tryPromise({ try: () => runtime.spacesd.scroll(input.x ?? 0, input.y!), catch: errorFromCause })
          }
        } else {
          if (input.action === "click") {
            if (input.x === undefined || input.y === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.click requires x and y" })
            state.fixture.text = `Clicked ${input.x},${input.y}`
          }
          if (input.action === "type") {
            if (input.text === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.type requires text" })
            state.fixture.text = `Typed ${input.text}`
          }
          if (input.action === "press") {
            if (!input.key) return yield* new ComputerError({ code: "invalid_action", message: "computer.press requires key" })
            state.fixture.text = `Pressed ${input.key}`
          }
          if (input.action === "scroll") {
            if (input.y === undefined) return yield* new ComputerError({ code: "invalid_action", message: "computer.scroll requires y" })
            state.fixture.text = `Scrolled ${input.y}`
          }
        }
        const observation = yield* observe(state)
        if (providerUnverified && before?.snapshot.hash === observation.snapshot.hash)
          return yield* new ComputerError({ code: "unavailable", message: `Cua Driver could not verify ${input.action}; the desktop snapshot did not change.` })
        return { output: `${input.action} completed by ${state.runtime ? runtimeLabel(state.runtime) : "fixture"}`, snapshot: observation.snapshot }
      }).pipe(
        Effect.tap((result) => {
          update(state, { snapshot: result.snapshot, lastActionAt: Date.now(), status: "ready", unavailableReason: undefined })
          return publish(events, ComputerSchema.Event.ActionCompleted, { computerSessionID: input.computerSessionID, actionID, action: input.action, status: "completed", output: result.output, ...(result.snapshot ? { snapshot: result.snapshot } : {}), ...(("artifact" in result && result.artifact) ? { artifactID: result.artifact.id } : {}) })
        }),
        Effect.tapError((error) => publish(events, ComputerSchema.Event.ActionCompleted, { computerSessionID: input.computerSessionID, actionID, action: input.action, status: "failed", error: error.message })),
      )
      return { actionID, action: input.action, computerSessionID: input.computerSessionID, ...output }
    })

    const replay = Effect.fn("Computer.replay")(function* (input: { readonly computerSessionID: ComputerSchema.ComputerSessionID; readonly after?: number; readonly limit: number }) {
      const limit = Math.min(Math.max(input.limit, 1), 100)
      const page = yield* readAggregate(database.db, { aggregateID: input.computerSessionID, after: input.after, limit, manifest: { definitions: new Map(ComputerSchema.Event.Definitions.map((definition) => [`${definition.type}.${definition.durable?.version ?? 0}`, definition])), schema: ComputerSchema.Events } }).pipe(Effect.mapError((cause) => new ComputerError({ code: "unavailable", message: String(cause) })))
      const head = yield* latestSequence(database.db, input.computerSessionID)
      const first = page.events[0]?.durable?.seq ?? input.after ?? 0
      return ComputerSchema.ReplayPage.make({ events: page.events, cursor: { earliest: first, head, ...(page.hasMore && page.events.at(-1)?.durable ? { next: String(page.events.at(-1)!.durable!.seq) } : {}) } })
    })

    return Service.of({ list: () => Effect.sync(() => [...sessions.values()].map((state) => state.info)), open, act, close, replay })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Location.node, FSUtil.node, Database.node, EventV2.node] })
