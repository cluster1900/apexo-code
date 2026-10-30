export * as Browser from "./browser"

import { Browser as BrowserSchema } from "@apexo/schema/browser"
import { Context, Effect, Layer, Schema } from "effect"
import { Location } from "./location"
import { FSUtil } from "./fs-util"
import { Database } from "./database/database"
import { EventV2, latestSequence, readAggregate } from "./event"
import { makeLocationNode } from "./effect/app-node"

const DEFAULT_CDP_URL = "http://127.0.0.1:9222"
const MAX_TEXT = 12_000
const MAX_ACCESSIBILITY_NODES = 200
const ACTION_TIMEOUT_MS = 15_000

export class BrowserError extends Schema.TaggedErrorClass<BrowserError>()("Browser.Error", {
  code: Schema.Literals([
    "invalid_url",
    "browser_disconnected",
    "page_not_found",
    "stale_target",
    "invalid_action",
    "cdp_error",
    "artifact_error",
  ]),
  message: Schema.String,
}) {}

type Pending = {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  readonly timer: ReturnType<typeof setTimeout>
}

type Connection = {
  readonly socket: WebSocket
  readonly targetID: string
  readonly pageID: BrowserSchema.PageID
  readonly pending: Map<number, Pending>
  readonly console: string[]
  nextID: number
  connected: boolean
}

type State = {
  info: BrowserSchema.Info
  readonly connection: Connection
}

type ActionOutput = {
  readonly output: string
  readonly page?: BrowserSchema.Page
  readonly artifact?: BrowserSchema.Artifact
  readonly artifactData?: string
}

export interface Interface {
  readonly list: () => Effect.Effect<BrowserSchema.Info[]>
  readonly open: (input: BrowserSchema.OpenInput) => Effect.Effect<BrowserSchema.Info, BrowserError>
  readonly act: (
    input: Omit<BrowserSchema.ActionInput, "browserSessionID"> & { readonly browserSessionID: BrowserSchema.BrowserSessionID },
  ) => Effect.Effect<{ readonly actionID: BrowserSchema.ActionID } & ActionOutput, BrowserError>
  readonly close: (browserSessionID: BrowserSchema.BrowserSessionID) => Effect.Effect<void, BrowserError>
  readonly replay: (input: {
    readonly browserSessionID: BrowserSchema.BrowserSessionID
    readonly after?: number
    readonly limit: number
  }) => Effect.Effect<BrowserSchema.ReplayPage, BrowserError>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/Browser") {}

const publish = (events: EventV2.Interface, definition: EventV2.Definition, data: unknown) =>
  events.publish(definition as never, data as never).pipe(Effect.asVoid, Effect.catch(() => Effect.void))

const asError = (cause: unknown) => (cause instanceof globalThis.Error ? cause : new globalThis.Error(String(cause)))

const cdpUrl = (value: string | undefined) => {
  const url = value ?? process.env.APEXO_BROWSER_CDP_URL ?? DEFAULT_CDP_URL
  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("ws://") && !url.startsWith("wss://"))
    throw new BrowserError({ code: "invalid_url", message: "Browser CDP URL must use http(s) or ws(s)" })
  return url
}

const cdpUrlEffect = (value: string | undefined) =>
  Effect.try({
    try: () => cdpUrl(value),
    catch: (cause) =>
      cause instanceof BrowserError
        ? cause
        : new BrowserError({ code: "invalid_url", message: "Browser CDP URL must use http(s) or ws(s)" }),
  })

const safeCdpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return value.startsWith("ws") ? value.split("?")[0] : value.split("/").slice(0, 3).join("/")
  }
}

const browserBase = (value: string) => {
  const parsed = new URL(value)
  if (parsed.protocol === "ws:" || parsed.protocol === "wss:") return undefined
  return `${parsed.protocol}//${parsed.host}`
}

const cdpRequest = (connection: Connection, method: string, params?: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () =>
      new Promise<unknown>((resolve, reject) => {
        if (!connection.connected) {
          reject(new BrowserError({ code: "browser_disconnected", message: "Browser CDP connection is closed" }))
          return
        }
        const id = connection.nextID++
        const timer = setTimeout(() => {
          connection.pending.delete(id)
          reject(new BrowserError({ code: "cdp_error", message: `CDP request timed out: ${method}` }))
        }, ACTION_TIMEOUT_MS)
        connection.pending.set(id, { resolve, reject, timer })
        try {
          connection.socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }))
        } catch (cause) {
          clearTimeout(timer)
          connection.pending.delete(id)
          reject(asError(cause))
        }
      }),
    catch: asError,
  })
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof BrowserError
          ? cause
          : new BrowserError({ code: "cdp_error", message: `CDP request failed: ${cause.message}` }),
      ),
    )

const responseResult = (method: string, value: unknown) => {
  if (!value || typeof value !== "object") throw new BrowserError({ code: "cdp_error", message: `Invalid CDP response: ${method}` })
  if ("error" in value) {
    const detail = value.error
    throw new BrowserError({ code: "cdp_error", message: `CDP ${method} failed: ${JSON.stringify(detail)}` })
  }
  return "result" in value ? value.result : value
}

const evaluate = (connection: Connection, expression: string) =>
  cdpRequest(connection, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }).pipe(
    Effect.map((value) => responseResult("Runtime.evaluate", value)),
    Effect.flatMap((value) => {
      if (!value || typeof value !== "object" || !("result" in value))
        return Effect.fail(new BrowserError({ code: "cdp_error", message: "Runtime.evaluate returned no value" }))
      const result = value.result
      if (!result || typeof result !== "object")
        return Effect.fail(new BrowserError({ code: "cdp_error", message: "Runtime.evaluate returned an invalid value" }))
      if ("exceptionDetails" in value) {
        const detail = value.exceptionDetails
        const description =
          detail && typeof detail === "object" && "exception" in detail && detail.exception && typeof detail.exception === "object" && "description" in detail.exception
            ? detail.exception.description
            : detail && typeof detail === "object" && "text" in detail
              ? detail.text
              : undefined
        return Effect.fail(
          new BrowserError({
            code: "cdp_error",
            message: typeof description === "string" ? `Browser page evaluation failed: ${description}` : "Browser page evaluation failed",
          }),
        )
      }
      return Effect.succeed("value" in result ? result.value : undefined)
    }),
  )

const pageState = (connection: Connection, pageID: BrowserSchema.PageID) =>
  evaluate(
    connection,
    `(() => {
      const text = document.body?.innerText ?? "";
      const source = document.documentElement?.outerHTML ?? "";
      let hash = 2166136261;
      for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
      return { url: location.href, title: document.title, text: text.slice(0, ${MAX_TEXT}), snapshotHash: (hash >>> 0).toString(16) };
    })()`,
  ).pipe(
    Effect.flatMap((value) => {
      if (!value || typeof value !== "object")
        return Effect.fail(new BrowserError({ code: "cdp_error", message: "Browser page snapshot was empty" }))
      const state = value as { url?: unknown; title?: unknown; text?: unknown; snapshotHash?: unknown }
      if (typeof state.url !== "string" || typeof state.title !== "string" || typeof state.snapshotHash !== "string")
        return Effect.fail(new BrowserError({ code: "cdp_error", message: "Browser page snapshot was invalid" }))
      return Effect.succeed({
        page: BrowserSchema.Page.make({ id: pageID, url: state.url, title: state.title, snapshotHash: state.snapshotHash }),
        text: typeof state.text === "string" ? state.text : "",
      })
    }),
  )

const accessibility = (connection: Connection) =>
  cdpRequest(connection, "Accessibility.getFullAXTree").pipe(
    Effect.map((value) => responseResult("Accessibility.getFullAXTree", value)),
    Effect.map((value) => {
      if (!value || typeof value !== "object" || !("nodes" in value) || !Array.isArray(value.nodes)) return []
      return value.nodes.slice(0, MAX_ACCESSIBILITY_NODES).flatMap((node) => {
        if (!node || typeof node !== "object") return []
        const item = node as { role?: { value?: unknown }; name?: { value?: unknown } }
        const role = typeof item.role?.value === "string" ? item.role.value : ""
        const name = typeof item.name?.value === "string" ? item.name.value : ""
        return role || name ? [`${role}${name ? `: ${name}` : ""}`] : []
      })
    }),
  )

const selectorExpression = (selector: string, expression: string) =>
  `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error("Element not found"); ${expression} })()`

const createConnection = (target: { id: string; webSocketDebuggerUrl?: string }, pageID: BrowserSchema.PageID) =>
  Effect.tryPromise({
    try: () =>
      new Promise<Connection>((resolve, reject) => {
        if (!target.webSocketDebuggerUrl) {
          reject(new globalThis.Error("CDP target did not expose a websocket"))
          return
        }
        const socket = new WebSocket(target.webSocketDebuggerUrl)
        const pending = new Map<number, Pending>()
        const connection: Connection = {
          socket,
          targetID: target.id,
          pageID,
          pending,
          console: [],
          nextID: 1,
          connected: false,
        }
        const failPending = (cause: unknown) => {
          connection.connected = false
          for (const [id, item] of pending) {
            clearTimeout(item.timer)
            item.reject(cause)
            pending.delete(id)
          }
        }
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown }
            if (typeof message.id === "number") {
              const item = pending.get(message.id)
              if (!item) return
              clearTimeout(item.timer)
              pending.delete(message.id)
              item.resolve(message)
              return
            }
            if (message.method === "Runtime.consoleAPICalled" && message.params && typeof message.params === "object") {
              const params = message.params as { args?: Array<{ value?: unknown }> }
              const line = (params.args ?? [])
                .map((arg) => (typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value)))
                .join(" ")
              if (line) connection.console.push(line.slice(0, MAX_TEXT))
              if (connection.console.length > 100) connection.console.shift()
            }
          } catch {
            failPending(new globalThis.Error("Invalid CDP message"))
          }
        }
        socket.onerror = () => failPending(new BrowserError({ code: "browser_disconnected", message: "Browser CDP connection failed" }))
        socket.onclose = () => failPending(new BrowserError({ code: "browser_disconnected", message: "Browser CDP connection closed" }))
        socket.onopen = () => {
          connection.connected = true
          resolve(connection)
        }
      }),
    catch: asError,
  }).pipe(
    Effect.timeoutOrElse({
      duration: ACTION_TIMEOUT_MS,
      orElse: () => Effect.fail(new BrowserError({ code: "browser_disconnected", message: "Timed out connecting to Browser CDP" })),
    }),
    Effect.mapError((cause) =>
      cause instanceof BrowserError
        ? cause
        : new BrowserError({ code: "browser_disconnected", message: `Unable to connect to Browser CDP: ${cause.message}` }),
    ),
  )

const discoverTarget = (cdp: string, url: string) =>
  Effect.tryPromise({
    try: async () => {
      const ws = cdp.startsWith("ws://") || cdp.startsWith("wss://")
      if (ws) return { id: "attached", webSocketDebuggerUrl: cdp }
      const base = browserBase(cdp)
      if (!base) throw new globalThis.Error("Invalid CDP endpoint")
      const list = async () => {
        const response = await fetch(`${base}/json/list`)
        if (!response.ok) throw new globalThis.Error(`CDP target list failed with ${response.status}`)
        return (await response.json()) as Array<{ id: string; type?: string; url?: string; webSocketDebuggerUrl?: string }>
      }
      const targets = (await list()).filter((target) => target.type === "page" && target.webSocketDebuggerUrl)
      const exact = targets.find((target) => target.url === url)
      if (exact) return exact
      // Reuse a blank tab, but never commandeer an unrelated active page. If
      // Chrome already has work open, create a dedicated target for this URL.
      const blank = targets.find((target) => target.url === "about:blank" || target.url === "chrome://newtab/")
      if (blank) return blank
      const response = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })
      if (!response.ok) throw new globalThis.Error(`CDP target creation failed with ${response.status}`)
      return (await response.json()) as { id: string; webSocketDebuggerUrl?: string }
    },
    catch: asError,
  }).pipe(
    Effect.mapError((cause) => new BrowserError({ code: "browser_disconnected", message: `Unable to discover Browser CDP target: ${cause.message}` })),
  )

const validateUrl = (value: string) => {
  const url = (() => {
    try {
      return new URL(value)
    } catch {
      throw new BrowserError({ code: "invalid_url", message: "Browser pages must use a valid http:// or https:// URL" })
    }
  })()
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new BrowserError({ code: "invalid_url", message: "Browser pages must use http:// or https://" })
  return url.toString()
}

const validateUrlEffect = (value: string) =>
  Effect.try({
    try: () => validateUrl(value),
    catch: (cause) =>
      cause instanceof BrowserError
        ? cause
        : new BrowserError({ code: "invalid_url", message: "Browser pages must use a valid http:// or https:// URL" }),
  })

const artifactPath = (browserSessionID: BrowserSchema.BrowserSessionID, artifactID: BrowserSchema.ArtifactID) =>
  `.apexo/browser/${browserSessionID}/${artifactID}.png`

const updateInfo = (state: State, info: Partial<BrowserSchema.Info>) => {
  state.info = BrowserSchema.Info.make({ ...state.info, ...info })
  return state.info
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const sessions = new Map<BrowserSchema.BrowserSessionID, State>()

    const emitPage = Effect.fnUntraced(function* (state: State, page: BrowserSchema.Page) {
      updateInfo(state, { page, status: "connected", lastActionAt: Date.now() })
      yield* publish(events, BrowserSchema.Event.PageChanged, { browserSessionID: state.info.id, page })
    })

    const observe = Effect.fn("Browser.observe")(function* (state: State) {
      const current = yield* pageState(state.connection, state.connection.pageID)
      yield* emitPage(state, current.page)
      const tree = yield* accessibility(state.connection).pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const logs = state.connection.console.slice(-20)
      return {
        output: JSON.stringify({ page: current.page, text: current.text, accessibility: tree, console: logs }),
        page: current.page,
      }
    })

    const ensureTarget = (state: State, input: { readonly pageID?: BrowserSchema.PageID; readonly expectedSnapshotHash?: string }) =>
      Effect.gen(function* () {
        if (!state.connection.connected || state.info.status !== "connected")
          return yield* new BrowserError({ code: "browser_disconnected", message: "Browser session is disconnected" })
        if (input.pageID && input.pageID !== state.connection.pageID)
          return yield* new BrowserError({ code: "stale_target", message: "The browser page changed; observe it again before acting" })
        if (input.expectedSnapshotHash) {
          const current = yield* pageState(state.connection, state.connection.pageID)
          if (current.page.snapshotHash !== input.expectedSnapshotHash)
            return yield* new BrowserError({ code: "stale_target", message: "The page changed; observe it again before acting" })
        }
      })

    const act = Effect.fn("Browser.act")(function* (
      input: Omit<BrowserSchema.ActionInput, "browserSessionID"> & { readonly browserSessionID: BrowserSchema.BrowserSessionID },
    ) {
      const state = sessions.get(input.browserSessionID)
      if (!state) return yield* new BrowserError({ code: "page_not_found", message: "Browser session not found" })
      const actionID = BrowserSchema.ActionID.create()
      yield* publish(events, BrowserSchema.Event.ActionStarted, {
        browserSessionID: state.info.id,
        actionID,
        action: input.action,
        ...(input.pageID ? { pageID: input.pageID } : {}),
      })
      const output = yield* Effect.gen(function* () {
        if (input.action === "close") {
          yield* close(input.browserSessionID)
          return { output: "Browser session closed" }
        }
        yield* ensureTarget(state, input)
        if (input.action === "open") {
          if (!input.url) return yield* new BrowserError({ code: "invalid_action", message: "browser.open requires url" })
          const url = yield* validateUrlEffect(input.url)
          yield* cdpRequest(state.connection, "Page.navigate", { url }).pipe(
            Effect.map((value) => responseResult("Page.navigate", value)),
          )
          yield* Effect.sleep(100)
          return yield* observe(state)
        }
        if (input.action === "observe") return yield* observe(state)
        if (input.action === "click") {
          if (!input.selector) return yield* new BrowserError({ code: "invalid_action", message: "browser.click requires selector" })
          yield* evaluate(state.connection, selectorExpression(input.selector, "element.click(); return true;"))
          yield* Effect.sleep(50)
          return yield* observe(state)
        }
        if (input.action === "type") {
          if (!input.selector || input.text === undefined)
            return yield* new BrowserError({ code: "invalid_action", message: "browser.type requires selector and text" })
          yield* evaluate(
            state.connection,
            selectorExpression(
              input.selector,
              "element.focus(); if (typeof element.select === 'function') element.select(); else document.execCommand('selectAll'); return true;",
            ),
          )
          yield* cdpRequest(state.connection, "Input.insertText", { text: input.text })
          return yield* observe(state)
        }
        if (input.action === "press") {
          if (!input.key) return yield* new BrowserError({ code: "invalid_action", message: "browser.press requires key" })
          yield* cdpRequest(state.connection, "Input.dispatchKeyEvent", { type: "keyDown", key: input.key })
          yield* cdpRequest(state.connection, "Input.dispatchKeyEvent", { type: "keyUp", key: input.key })
          return yield* observe(state)
        }
        if (input.action === "scroll") {
          if (input.x === undefined || input.y === undefined)
            return yield* new BrowserError({ code: "invalid_action", message: "browser.scroll requires x and y" })
          yield* evaluate(state.connection, `window.scrollBy(${input.x}, ${input.y}); true`)
          return yield* observe(state)
        }
        if (input.action === "screenshot") {
          const screenshot = yield* cdpRequest(state.connection, "Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: input.fullPage === true,
          }).pipe(Effect.map((value) => responseResult("Page.captureScreenshot", value)))
          if (!screenshot || typeof screenshot !== "object" || !("data" in screenshot) || typeof screenshot.data !== "string")
            return yield* new BrowserError({ code: "artifact_error", message: "Browser did not return a screenshot" })
          const screenshotData = screenshot.data
          const artifactID = BrowserSchema.ArtifactID.create()
          const relativePath = artifactPath(state.info.id, artifactID)
          const bytes = Buffer.from(screenshotData, "base64")
          yield* fs.writeWithDirs(`${location.directory}/${relativePath}`, bytes).pipe(
            Effect.mapError((cause) => new BrowserError({ code: "artifact_error", message: `Unable to save screenshot: ${cause}` })),
          )
          const artifact = BrowserSchema.Artifact.make({
            id: artifactID,
            mime: "image/png",
            relativePath,
            byteLength: bytes.byteLength,
            sensitive: false,
          })
          yield* publish(events, BrowserSchema.Event.ArtifactCreated, { browserSessionID: state.info.id, artifact })
          const current = yield* pageState(state.connection, state.connection.pageID)
          yield* emitPage(state, current.page)
          return { output: `Screenshot saved as ${relativePath}`, page: current.page, artifact, artifactData: screenshotData }
        }
        return yield* new BrowserError({ code: "invalid_action", message: `Unsupported browser action: ${input.action}` })
      }).pipe(
        Effect.tap((result) =>
          publish(events, BrowserSchema.Event.ActionCompleted, {
            browserSessionID: state.info.id,
            actionID,
            action: input.action,
            status: "completed",
            output: result.output,
            ...(result.page ? { page: result.page } : {}),
            ...(("artifact" in result && result.artifact) ? { artifactID: result.artifact.id } : {}),
          }),
        ),
        Effect.tapError((error) =>
          publish(events, BrowserSchema.Event.ActionCompleted, {
            browserSessionID: state.info.id,
            actionID,
            action: input.action,
            status: "failed",
            error: error instanceof BrowserError ? error.message : String(error),
          }),
        ),
      )
      return { actionID, ...output }
    })

    const close = Effect.fn("Browser.close")(function* (browserSessionID: BrowserSchema.BrowserSessionID) {
      const state = sessions.get(browserSessionID)
      if (!state) return
      state.connection.connected = false
      state.connection.socket.close()
      updateInfo(state, { status: "closed", lastActionAt: Date.now() })
      yield* publish(events, BrowserSchema.Event.Closed, { browserSessionID })
      sessions.delete(browserSessionID)
    })

    const open = Effect.fn("Browser.open")(function* (input: BrowserSchema.OpenInput) {
      const url = yield* validateUrlEffect(input.url)
      const endpoint = yield* cdpUrlEffect(input.cdpUrl)
      const target = yield* discoverTarget(endpoint, url)
      const browserSessionID = BrowserSchema.BrowserSessionID.create()
      const pageID = BrowserSchema.PageID.create()
      const connection = yield* createConnection(target, pageID).pipe(
        Effect.mapError((cause) =>
          cause instanceof BrowserError
            ? cause
            : new BrowserError({ code: "browser_disconnected", message: `Unable to connect to Browser CDP: ${cause}` }),
        ),
      )
      yield* cdpRequest(connection, "Runtime.enable")
      yield* cdpRequest(connection, "Page.enable")
      yield* cdpRequest(connection, "Network.enable")
      yield* cdpRequest(connection, "Page.navigate", { url }).pipe(
        Effect.map((value) => responseResult("Page.navigate", value)),
      )
      yield* Effect.sleep(100)
      const current = yield* pageState(connection, pageID)
      const info = BrowserSchema.Info.make({
        id: browserSessionID,
        sessionID: input.sessionID,
        status: "connected",
        cdpUrl: safeCdpUrl(endpoint),
        page: current.page,
        createdAt: Date.now(),
        lastActionAt: Date.now(),
      })
      const state = {
        info,
        connection,
      } satisfies State
      sessions.set(browserSessionID, state)
      yield* publish(events, BrowserSchema.Event.Started, {
        browserSessionID,
        sessionID: input.sessionID,
        info,
      })
      yield* publish(events, BrowserSchema.Event.PageChanged, { browserSessionID, page: current.page })
      return info
    })

    const replay = Effect.fn("Browser.replay")(function* (input: {
      readonly browserSessionID: BrowserSchema.BrowserSessionID
      readonly after?: number
      readonly limit: number
    }) {
      const limit = Math.min(Math.max(input.limit, 1), 100)
      const page = yield* readAggregate(database.db, {
        aggregateID: input.browserSessionID,
        after: input.after,
        limit,
        manifest: {
          definitions: new Map(BrowserSchema.Event.Definitions.map((definition) => [
            `${definition.type}.${definition.durable?.version ?? 0}`,
            definition,
          ])),
          schema: BrowserSchema.Events,
        },
      }).pipe(Effect.mapError((cause) => new BrowserError({ code: "cdp_error", message: String(cause) })))
      const head = yield* latestSequence(database.db, input.browserSessionID)
      const first = page.events[0]?.durable?.seq ?? input.after ?? 0
      return BrowserSchema.ReplayPage.make({
        events: page.events,
        cursor: {
          earliest: first,
          head,
          ...(page.hasMore && page.events.at(-1)?.durable ? { next: String(page.events.at(-1)!.durable!.seq) } : {}),
        },
      })
    })

    return Service.of({
      list: () => Effect.sync(() => [...sessions.values()].map((state) => state.info)),
      open,
      act,
      close,
      replay,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, FSUtil.node, Database.node, EventV2.node],
})
