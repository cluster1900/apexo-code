export * as Browser from "./browser"

import type { StagehandBrowser } from "@browserbasehq/stagehand"
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

type Connection = {
  readonly close: () => Promise<void>
  readonly page: PageAdapter
  readonly pageID: BrowserSchema.PageID
  readonly console: string[]
  connected: boolean
}

type PageAdapter = {
  readonly closed: () => boolean
  readonly url: () => Promise<string>
  readonly title: () => Promise<string>
  readonly goto: (url: string, timeout: number) => Promise<unknown>
  readonly evaluate: (expression: string, arg?: unknown) => Promise<unknown>
  readonly snapshot: () => Promise<string[]>
  readonly click: (selector: string, timeout: number) => Promise<void>
  readonly fill: (selector: string, value: string, timeout: number) => Promise<void>
  readonly keyPress: (key: string) => Promise<void>
  readonly scroll: (x: number, y: number) => Promise<void>
  readonly screenshot: (fullPage: boolean) => Promise<Uint8Array>
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

const connectionError = (cause: unknown) =>
  cause instanceof BrowserError
    ? cause
    : new BrowserError({ code: "browser_disconnected", message: `Unable to connect to Browser CDP: ${asError(cause).message}` })

const stagehandPage = (page: import("@browserbasehq/stagehand").Page): PageAdapter => ({
  closed: () => false,
  url: () => page.url(),
  title: () => page.title(),
  goto: (url, timeout) => page.goto(url, { timeout }),
  evaluate: (expression, arg) => page.evaluate(expression, arg),
  snapshot: async () => (await page.snapshot({ timeout: ACTION_TIMEOUT_MS })).formattedTree.split("\n").slice(0, MAX_ACCESSIBILITY_NODES),
  click: (selector, timeout) => page.locator(selector).click({ timeout }),
  fill: (selector, value, timeout) => page.locator(selector).fill(value, { timeout }),
  keyPress: (key) => page.keyPress(key),
  scroll: (x, y) => page.scroll(0, 0, x, y),
  screenshot: (fullPage) => page.screenshot({ type: "png", fullPage }),
})

const playwrightPage = (page: import("playwright-core").Page): PageAdapter => ({
  closed: () => page.isClosed(),
  url: () => Promise.resolve(page.url()),
  title: () => page.title(),
  goto: (url, timeout) => page.goto(url, { waitUntil: "domcontentloaded", timeout }),
  evaluate: (expression, arg) => page.evaluate(expression, arg),
  snapshot: async () => {
    const snapshot = await page.locator("body").ariaSnapshot({ timeout: ACTION_TIMEOUT_MS })
    return snapshot.split("\n").slice(0, MAX_ACCESSIBILITY_NODES)
  },
  click: (selector, timeout) => page.locator(selector).click({ timeout }),
  fill: (selector, value, timeout) => page.locator(selector).fill(value, { timeout }),
  keyPress: (key) => page.keyboard.press(key),
  scroll: (x, y) => page.evaluate("({x, y}) => globalThis.scrollBy(x, y)", { x, y }).then(() => undefined),
  screenshot: (fullPage) => page.screenshot({ type: "png", fullPage }),
})

const stagehandCompatibilityFallback = (cause: unknown) => /Extensions\.getExtensions|Method not available/iu.test(asError(cause).message)

const connect = (endpoint: string, url: string, pageID: BrowserSchema.PageID) =>
  Effect.tryPromise({
    try: async () => {
      let stagehandBrowser: StagehandBrowser | undefined
      try {
        const { localBrowser, Stagehand } = await import("@browserbasehq/stagehand")
        stagehandBrowser = await localBrowser.connect({ cdpUrl: endpoint })
        const stagehand = await Stagehand.create({ browser: stagehandBrowser, logging: { level: "off" } })
        const context = stagehandBrowser.context
        const pages = await context.pages()
        const pageStates = await Promise.all(pages.map(async (item) => ({ item, url: await item.url() })))
        const page =
          pageStates.find((item) => item.url === url)?.item ??
          pageStates.find((item) => item.url === "about:blank" || item.url === "chrome://newtab/")?.item ??
          (await context.newPage())
        const adapter = stagehandPage(page)
        await adapter.goto(url, ACTION_TIMEOUT_MS)
        return { close: () => stagehand.close(), page: adapter, pageID, console: [], connected: true }
      } catch (cause) {
        if (!stagehandCompatibilityFallback(cause)) {
          await stagehandBrowser?.close().catch(() => undefined)
          throw cause
        }
        await stagehandBrowser?.close().catch(() => undefined)
        const { chromium } = await import("playwright-core")
        const browser = await chromium.connectOverCDP(endpoint, { timeout: ACTION_TIMEOUT_MS })
        try {
          const context = browser.contexts()[0]
          if (!context) throw new globalThis.Error("Browser CDP did not expose a browser context")
          const pages = context.pages()
          const page =
            pages.find((item) => item.url() === url) ??
            pages.find((item) => item.url() === "about:blank" || item.url() === "chrome://newtab/") ??
            (await context.newPage())
          const adapter = playwrightPage(page)
          await adapter.goto(url, ACTION_TIMEOUT_MS)
          return { close: () => browser.close(), page: adapter, pageID, console: [], connected: true }
        } catch (error) {
          await browser.close().catch(() => undefined)
          throw error
        }
      }
    },
    catch: connectionError,
  }).pipe(
    Effect.timeoutOrElse({
      duration: ACTION_TIMEOUT_MS,
      orElse: () => Effect.fail(new BrowserError({ code: "browser_disconnected", message: "Timed out connecting to Browser CDP" })),
    }),
    Effect.mapError(connectionError),
  )

const pageState = (connection: Connection, pageID: BrowserSchema.PageID) =>
  Effect.tryPromise({
    try: async () => {
      if (!connection.connected || connection.page.closed())
        throw new BrowserError({ code: "browser_disconnected", message: "Browser page is closed" })
      const url = await connection.page.url()
      const title = await connection.page.title()
      const state = (await connection.page.evaluate(
        "({ text: (document.body?.innerText ?? '').slice(0, 12000), source: document.documentElement?.outerHTML ?? '' })",
      )) as { readonly text: string; readonly source: string }
      let hash = 2166136261
      for (let index = 0; index < state.source.length; index++) hash = Math.imul(hash ^ state.source.charCodeAt(index), 16777619)
      return {
        page: BrowserSchema.Page.make({
          id: pageID,
          url,
          title,
          snapshotHash: (hash >>> 0).toString(16),
        }),
        text: state.text,
      }
    },
    catch: (cause) =>
      cause instanceof BrowserError
        ? cause
        : new BrowserError({ code: "cdp_error", message: `Browser page snapshot failed: ${asError(cause).message}` }),
  })

const accessibility = (connection: Connection) =>
  Effect.tryPromise({
    try: async () => {
      return await connection.page.snapshot()
    },
    catch: asError,
  }).pipe(Effect.orElseSucceed(() => [] as string[]))

const actionError = (action: string, cause: unknown) =>
  cause instanceof BrowserError
    ? cause
    : new BrowserError({ code: "cdp_error", message: `Browser ${action} failed: ${asError(cause).message}` })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const sessions = new Map<BrowserSchema.BrowserSessionID, State>()

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        [...sessions.values()],
        (state) => Effect.promise(() => state.connection.close()).pipe(Effect.ignore),
        { discard: true },
      ).pipe(Effect.andThen(Effect.sync(() => sessions.clear()))),
    )

    const emitPage = Effect.fnUntraced(function* (state: State, page: BrowserSchema.Page) {
      updateInfo(state, { page, status: "connected", lastActionAt: Date.now(), disconnectedReason: undefined })
      yield* publish(events, BrowserSchema.Event.PageChanged, { browserSessionID: state.info.id, page })
    })

    const observe = Effect.fn("Browser.observe")(function* (state: State) {
      const current = yield* pageState(state.connection, state.connection.pageID)
      yield* emitPage(state, current.page)
      const tree = yield* accessibility(state.connection)
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

    const close = Effect.fn("Browser.close")(function* (browserSessionID: BrowserSchema.BrowserSessionID) {
      const state = sessions.get(browserSessionID)
      if (!state) return
      state.connection.connected = false
      sessions.delete(browserSessionID)
      yield* Effect.promise(() => state.connection.close()).pipe(Effect.ignore)
      updateInfo(state, { status: "closed", lastActionAt: Date.now() })
      yield* publish(events, BrowserSchema.Event.Closed, { browserSessionID })
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
          yield* Effect.tryPromise({
            try: () => state.connection.page.goto(url, ACTION_TIMEOUT_MS),
            catch: (cause) => actionError("open", cause),
          })
          yield* Effect.sleep(100)
          return yield* observe(state)
        }
        if (input.action === "observe") return yield* observe(state)
        if (input.action === "click") {
          if (!input.selector) return yield* new BrowserError({ code: "invalid_action", message: "browser.click requires selector" })
          yield* Effect.tryPromise({
            try: () => state.connection.page.click(input.selector!, ACTION_TIMEOUT_MS),
            catch: (cause) => actionError("click", cause),
          })
          yield* Effect.sleep(50)
          return yield* observe(state)
        }
        if (input.action === "type") {
          if (!input.selector || input.text === undefined)
            return yield* new BrowserError({ code: "invalid_action", message: "browser.type requires selector and text" })
          yield* Effect.tryPromise({
            try: () => state.connection.page.fill(input.selector!, input.text!, ACTION_TIMEOUT_MS),
            catch: (cause) => actionError("type", cause),
          })
          return yield* observe(state)
        }
        if (input.action === "press") {
          if (!input.key) return yield* new BrowserError({ code: "invalid_action", message: "browser.press requires key" })
          yield* Effect.tryPromise({
            try: () => state.connection.page.keyPress(input.key!),
            catch: (cause) => actionError("press", cause),
          })
          return yield* observe(state)
        }
        if (input.action === "scroll") {
          const x = input.x
          const y = input.y
          if (x === undefined || y === undefined)
            return yield* new BrowserError({ code: "invalid_action", message: "browser.scroll requires x and y" })
          yield* Effect.tryPromise({
            try: () => state.connection.page.scroll(x, y),
            catch: (cause) => actionError("scroll", cause),
          })
          return yield* observe(state)
        }
        if (input.action === "screenshot") {
          const screenshot = yield* Effect.tryPromise({
            try: () => state.connection.page.screenshot(input.fullPage === true),
            catch: (cause) => actionError("screenshot", cause),
          })
          const screenshotData = Buffer.from(screenshot).toString("base64")
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

    const open = Effect.fn("Browser.open")(function* (input: BrowserSchema.OpenInput) {
      const url = yield* validateUrlEffect(input.url)
      const endpoint = yield* cdpUrlEffect(input.cdpUrl)
      const browserSessionID = BrowserSchema.BrowserSessionID.create()
      const pageID = BrowserSchema.PageID.create()
      const connection = yield* connect(endpoint, url, pageID)
      const current = yield* pageState(connection, pageID).pipe(
        Effect.tapError(() => Effect.promise(() => connection.close()).pipe(Effect.ignore)),
      )
      const info = BrowserSchema.Info.make({
        id: browserSessionID,
        sessionID: input.sessionID,
        status: "connected",
        cdpUrl: safeCdpUrl(endpoint),
        page: current.page,
        createdAt: Date.now(),
        lastActionAt: Date.now(),
      })
      const state = { info, connection } satisfies State
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
