import { taskMessageDraft } from "@apexo/sdk/v2/task-message"
import { nativeMemoryActions } from "@apexo/tui/util/session-memory"
import { mcpActions } from "@apexo/tui/component/mcp-browser"
import { pluginsActions } from "@apexo/tui/component/plugins-browser"
import { workflowActions } from "@apexo/tui/component/workflow-browser"
import { taskActions } from "@apexo/tui/util/session-tasks"
import { goalActions } from "@apexo/tui/component/session-goal"
// Top-level orchestrator for `apexo --mini`.
//
// Wires the boot sequence, lifecycle (renderer + footer), stream transport,
// and prompt queue together into a single session loop. Two entry points:
//
//   runInteractiveMode     -- used when an SDK client already exists (attach mode)
//   runInteractiveLocalMode -- used for local in-process mode (no server)
//
// Both delegate to runInteractiveRuntime, which:
//   1. resolves TUI config, model info, and session history,
//   2. creates the split-footer lifecycle (renderer + RunFooter),
//   3. starts the stream transport (SDK event subscription), lazily for fresh
//      local sessions,
//   4. runs the prompt queue until the footer closes.
import { createApexoClient } from "@apexo/sdk/v2/client"
import { parseBrowserCommand } from "@apexo/sdk/v2/browser-command"
import { parseComputerCommand } from "@apexo/sdk/v2/computer-command"
import { Flag } from "@apexo/core/flag/flag"
import { MessageID } from "@/session/schema"
import { createRunDemo } from "./demo"
import {
  resolveModelInfo,
  resolveNativeModelInfo,
  resolveNativeSessionInfo,
  resolveRunTuiConfig,
  resolveSessionInfo,
} from "./runtime.boot"
import { createRuntimeLifecycle } from "./runtime.lifecycle"
import { trace } from "./trace"
import { cycleVariant, formatModelLabel, resolveSavedVariant, resolveVariant, saveVariant } from "./variant.shared"
import type { LocalReplayAnchor, LocalReplayRow, RunBrowserActions, RunComputerActions, RunInput, RunPrompt, RunProvider, StreamCommit } from "./types"

/** @internal Exported for testing */
export { pickVariant, resolveVariant } from "./variant.shared"

/** @internal Exported for testing */
export { runPromptQueue } from "./runtime.queue"

type BootContext = Pick<
  RunInput,
  "sdk" | "native" | "directory" | "sessionID" | "sessionTitle" | "resume" | "agent" | "model" | "variant"
>

type CreateSessionInput = {
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
}

type CreateSession = (sdk: RunInput["sdk"], input: CreateSessionInput) => Promise<{ id: string; title?: string }>

type RunRuntimeInput = {
  startupNotice?: string
  signal?: AbortSignal
  boot: () => Promise<BootContext>
  afterPaint?: (ctx: BootContext) => Promise<void> | void
  resolveSession?: (
    ctx: BootContext,
  ) => Promise<{ sessionID: string; sessionTitle?: string; agent?: string | undefined }>
  createSession?: (ctx: BootContext, input: CreateSessionInput) => Promise<ResolvedSession>
  files: RunInput["files"]
  initialInput?: string
  thinking: boolean
  backgroundSubagents: boolean
  replay?: boolean
  replayLimit?: number
  demo?: RunInput["demo"]
}

type RunLocalInput = {
  directory: string
  fetch: typeof globalThis.fetch
  resolveAgent: () => Promise<string | undefined>
  session: (sdk: RunInput["sdk"]) => Promise<{ id: string; title?: string } | undefined>
  createSession?: CreateSession
  agent: RunInput["agent"]
  model: RunInput["model"]
  variant: RunInput["variant"]
  files: RunInput["files"]
  initialInput?: string
  thinking: boolean
  backgroundSubagents: boolean
  replay?: boolean
  replayLimit?: number
  demo?: RunInput["demo"]
}

type StreamTransportModule = Pick<
  Awaited<typeof import("./stream.transport")>,
  "createSessionTransport" | "formatUnknownError"
>

export type RunRuntimeDeps = {
  createRuntimeLifecycle?: typeof createRuntimeLifecycle
  streamTransport?: Promise<StreamTransportModule>
}

type StreamState = {
  mod: StreamTransportModule
  handle: Awaited<ReturnType<StreamTransportModule["createSessionTransport"]>>
}

type ResolvedSession = {
  sessionID: string
  sessionTitle?: string
  agent?: string | undefined
}

function createSessionResolver(fn?: CreateSession) {
  if (!fn) {
    return undefined
  }

  return async (ctx: BootContext, input: CreateSessionInput): Promise<ResolvedSession> => {
    const created = await fn(ctx.sdk, input)
    if (!created.id) {
      throw new Error("Failed to create session")
    }

    return {
      sessionID: created.id,
      sessionTitle: created.title,
      agent: input.agent,
    }
  }
}

type RuntimeState = {
  shown: boolean
  aborting: boolean
  model: RunInput["model"]
  providers: RunProvider[]
  variants: string[]
  limits: Record<string, number>
  activeVariant: string | undefined
  sessionID: string
  history: RunPrompt[]
  localRows: LocalReplayRow[]
  sessionTitle?: string
  agent: string | undefined
  switching?: Promise<void>
  demo?: ReturnType<typeof createRunDemo>
  selectSubagent?: (sessionID: string | undefined) => void
  session?: Promise<void>
  stream?: Promise<StreamState>
}

function hasSession(input: RunRuntimeInput, state: RuntimeState) {
  return !input.resolveSession || !!state.sessionID
}

function eagerStream(input: RunRuntimeInput, ctx: BootContext) {
  return ctx.resume === true || !input.resolveSession || !!input.demo
}

function variantsFor(providers: RunProvider[], model: RunInput["model"]) {
  if (!model) {
    return []
  }

  return Object.keys(providers.find((item) => item.id === model.providerID)?.models?.[model.modelID]?.variants ?? {})
}

const RESIZE_DELAY = 250
const LOCAL_REPLAY_ROW_LIMIT = 100

async function resolveExitTitle(
  ctx: BootContext,
  input: RunRuntimeInput,
  state: RuntimeState,
): Promise<string | undefined> {
  if (!state.shown || !hasSession(input, state)) {
    return undefined
  }

  if (ctx.native) return ctx.native.get(state.sessionID).then((value) => value.title ?? undefined)

  return ctx.sdk.session
    .get({
      sessionID: state.sessionID,
    })
    .then((x) => x.data?.title)
    .catch(() => undefined)
}

// Core runtime loop. Boot resolves the SDK context, then we set up the
// lifecycle (renderer + footer), wire the stream transport for SDK events,
// and feed prompts through the queue until the user exits.
//
// Files only attach on the first prompt turn -- after that, includeFiles
// flips to false so subsequent turns don't re-send attachments.
async function runInteractiveRuntime(input: RunRuntimeInput, deps: RunRuntimeDeps = {}): Promise<void> {
  const start = performance.now()
  const log = trace()
  const tuiConfigTask = resolveRunTuiConfig()
  const ctx = await input.boot()
  const modelTask = ctx.native
    ? resolveNativeModelInfo(ctx.native, ctx.model)
    : resolveModelInfo(ctx.sdk, ctx.directory, ctx.model)
  const sessionTask =
    ctx.resume === true
      ? ctx.native
        ? resolveNativeSessionInfo(ctx.native, ctx.sessionID, ctx.model)
        : resolveSessionInfo(ctx.sdk, ctx.sessionID, ctx.model)
      : Promise.resolve({
          first: true,
          history: [],
          variant: undefined,
        })
  const savedTask = resolveSavedVariant(ctx.model)
  const [tuiConfig, session, savedVariant] = await Promise.all([tuiConfigTask, sessionTask, savedTask])
  const state: RuntimeState = {
    shown: !session.first,
    aborting: false,
    model: ctx.model,
    providers: [],
    variants: [],
    limits: {},
    activeVariant: resolveVariant(ctx.variant, session.variant, savedVariant, []),
    sessionID: ctx.sessionID,
    history: [...session.history],
    localRows: [],
    sessionTitle: ctx.sessionTitle,
    agent: ctx.agent,
  }
  const ensureSession = () => {
    if (!input.resolveSession || state.sessionID) {
      return Promise.resolve()
    }

    if (state.session) {
      return state.session
    }

    state.session = input.resolveSession(ctx).then((next) => {
      state.sessionID = next.sessionID
      state.sessionTitle = next.sessionTitle ?? state.sessionTitle
      state.agent = next.agent
    })
    return state.session
  }

  const browser = {
    sessionID: undefined as string | undefined,
    browserSessionID: undefined as string | undefined,
    pageID: undefined as string | undefined,
    snapshotHash: undefined as string | undefined,
  }
  const runBrowserCommand = async (args: string) => {
    await ensureSession()
    const sessionID = state.sessionID
    if (!sessionID) throw new Error("Session is unavailable")
    if (browser.sessionID !== sessionID) {
      browser.sessionID = sessionID
      browser.browserSessionID = undefined
      browser.pageID = undefined
      browser.snapshotHash = undefined
    }

    const command = parseBrowserCommand(args)
    if (command.action === "help") return command.message ?? "Usage: /browser <action>"
    if (command.action === "open") {
      const result = (
        await ctx.sdk.v2.browser.open(
          { sessionID, url: command.url, cdpUrl: command.cdpUrl },
          { throwOnError: true },
        )
      ).data
      browser.browserSessionID = result.id
      browser.pageID = result.page?.id
      browser.snapshotHash = result.page?.snapshotHash
      return `browser opened ${result.page?.url ?? command.url} (${result.id})`
    }

    if (!browser.browserSessionID) throw new Error("No browser session. Run /browser open <url> first")
    if (command.action === "close") {
      await ctx.sdk.v2.browser.close({ sessionID, browserSessionID: browser.browserSessionID }, { throwOnError: true })
      const closed = browser.browserSessionID
      browser.browserSessionID = undefined
      browser.pageID = undefined
      browser.snapshotHash = undefined
      return `browser closed ${closed}`
    }
    if (command.action === "events") {
      const result = (
        await ctx.sdk.v2.browser.events(
          {
            sessionID,
            browserSessionID: browser.browserSessionID,
            after: command.after === undefined ? undefined : String(command.after),
            limit: command.limit === undefined ? undefined : String(command.limit),
          },
          { throwOnError: true },
        )
      ).data
      return result.events.length === 0
        ? "browser events: none"
        : `browser events:\n${result.events.map((event) => `${event.type} ${event.durable?.seq ?? ""}`.trim()).join("\n")}`
    }

    const result = (
      await ctx.sdk.v2.browser.action(
        {
          sessionID,
          browserSessionID: browser.browserSessionID,
          action: command.action,
          pageID: browser.pageID,
          selector: command.action === "click" || command.action === "type" ? command.selector : undefined,
          text: command.action === "type" ? command.text : undefined,
          key: command.action === "press" ? command.key : undefined,
          x: command.action === "scroll" ? command.x : undefined,
          y: command.action === "scroll" ? command.y : undefined,
          expectedSnapshotHash: browser.snapshotHash,
          fullPage: command.action === "screenshot" ? command.fullPage : undefined,
          destructive: ["click", "type", "press", "scroll"].includes(command.action),
        },
        { throwOnError: true },
      )
    ).data
    browser.pageID = result.page?.id ?? browser.pageID
    browser.snapshotHash = result.page?.snapshotHash ?? browser.snapshotHash
    if (result.artifact) return `browser ${command.action}: ${result.artifact.relativePath}`
    return `browser ${command.action}: ${result.output || result.page?.url || "ok"}`
  }
  let browserQueue: Promise<unknown> = Promise.resolve()
  const browserActions: RunBrowserActions = {
    run: (args) => {
      const next = browserQueue.then(() => runBrowserCommand(args))
      browserQueue = next.catch(() => undefined)
      return next
    },
    runTask: async (task) => {
      await ensureSession()
      const parentID = state.sessionID
      if (!parentID) throw new Error("Session is unavailable")
      const title = `Browser: ${task.trim().slice(0, 96)}`
      if (ctx.native) {
        const child = await ctx.native.create({ parentID, agent: "browser" })
        if (state.stream) await (await state.stream).handle.registerSubagent?.({ sessionID: child.id, title })
        await ctx.native.admit({ sessionID: child.id, prompt: { text: task.trim() }, delivery: "steer" })
        return `browser subagent started ${child.id}: ${title}`
      }
      const child = (
        await ctx.sdk.session.create({ parentID, title, directory: ctx.directory }, { throwOnError: true })
      ).data
      if (state.stream) await (await state.stream).handle.registerSubagent?.({ sessionID: child.id, title })
      await ctx.sdk.session.promptAsync(
        {
          sessionID: child.id,
          agent: "browser",
          parts: [{ type: "text", text: task.trim() }],
          directory: ctx.directory,
        },
        { throwOnError: true },
      )
      return `browser subagent started ${child.id}: ${title}`
    },
  }
  const computer = {
    sessionID: undefined as string | undefined,
    computerSessionID: undefined as string | undefined,
    snapshotHash: undefined as string | undefined,
  }
  const runComputerCommand = async (args: string) => {
    const sessionID = state.sessionID
    if (!sessionID) throw new Error("Open a session before using /computer")
    if (computer.sessionID !== sessionID) {
      computer.sessionID = sessionID
      computer.computerSessionID = undefined
      computer.snapshotHash = undefined
    }
    const command = parseComputerCommand(args)
    if (command.action === "help") return command.message ?? "Usage: /computer <action>"
    if (command.action === "open") {
      const result = (await ctx.sdk.v2.computer.open({ sessionID, backend: "auto" }, { throwOnError: true })).data
      computer.computerSessionID = result.id
      computer.snapshotHash = result.snapshot?.hash
      return `computer opened (${result.id})${result.unavailableReason ? `: ${result.unavailableReason}` : ""}`
    }
    if (!computer.computerSessionID) throw new Error("No computer session. Run /computer open first")
    if (command.action === "close") {
      await ctx.sdk.v2.computer.close({ sessionID, computerSessionID: computer.computerSessionID }, { throwOnError: true })
      const closed = computer.computerSessionID
      computer.computerSessionID = undefined
      computer.snapshotHash = undefined
      return `computer closed ${closed}`
    }
    if (command.action === "events") {
      const result = (await ctx.sdk.v2.computer.events({ sessionID, computerSessionID: computer.computerSessionID, after: command.after === undefined ? undefined : String(command.after), limit: command.limit === undefined ? undefined : String(command.limit) }, { throwOnError: true })).data
      return result.events.length === 0 ? "computer events: none" : `computer events:\n${result.events.map((event) => `${event.type} ${event.durable?.seq ?? ""}`.trim()).join("\n")}`
    }
    const result = (await ctx.sdk.v2.computer.action({
      sessionID,
      computerSessionID: computer.computerSessionID,
      action: command.action,
      x: command.action === "click" ? command.x : undefined,
      y: command.action === "click" || command.action === "scroll" ? command.y : undefined,
      text: command.action === "type" ? command.text : undefined,
      key: command.action === "press" ? command.key : undefined,
      expectedSnapshotHash: computer.snapshotHash,
      destructive: ["click", "type", "press", "scroll", "close"].includes(command.action),
    }, { throwOnError: true })).data
    computer.snapshotHash = result.snapshot?.hash ?? computer.snapshotHash
    return result.artifact ? `computer ${command.action}: ${result.artifact.relativePath}` : `computer ${command.action}: ${result.output || "ok"}`
  }
  let computerQueue: Promise<unknown> = Promise.resolve()
  const computerActions: RunComputerActions = {
    run: (args) => {
      const next = computerQueue.then(() => runComputerCommand(args))
      computerQueue = next.catch(() => undefined)
      return next
    },
  }

  const tasks = taskActions(
    ctx.sdk,
    () => state.sessionID,
    async () => (ctx.native ? "native" : "compatibility"),
  )
  const shell = await (deps.createRuntimeLifecycle ?? createRuntimeLifecycle)({
    directory: ctx.directory,
    findFiles: (query) =>
      ctx.sdk.find
        .files({ query, directory: ctx.directory })
        .then((x) => x.data ?? [])
        .catch(() => []),
    agents: [],
    resources: [],
    sessionID: state.sessionID,
    sessionTitle: state.sessionTitle,
    getSessionID: () => state.sessionID,
    first: session.first,
    history: session.history,
    agent: state.agent,
    model: state.model,
    variant: state.activeVariant,
    tuiConfig,
    backgroundSubagents: input.backgroundSubagents,
    onPermissionReply: async (next) => {
      if (state.demo?.permission(next)) {
        return
      }

      log?.write("send.permission.reply", next)
      if (ctx.native) {
        if (!next.sessionID) throw new Error("Native permission reply is missing its original Session")
        await ctx.native.replyPermission({ sessionID: next.sessionID, requestID: next.requestID, reply: next.reply })
        return
      }
      await ctx.sdk.permission.reply(next)
    },
    onQuestionReply: async (next) => {
      if (state.demo?.questionReply(next)) {
        return
      }

      if (ctx.native) {
        if (!next.sessionID || !next.answers)
          throw new Error("Native question reply is missing its original Session or answers")
        await ctx.native.replyQuestion({
          sessionID: next.sessionID,
          requestID: next.requestID,
          questionV2Reply: { answers: next.answers },
        })
        return
      }
      await ctx.sdk.question.reply(next)
    },
    onQuestionReject: async (next) => {
      if (state.demo?.questionReject(next)) {
        return
      }

      if (ctx.native) {
        if (!next.sessionID) throw new Error("Native question rejection is missing its original Session")
        await ctx.native.rejectQuestion({ sessionID: next.sessionID, requestID: next.requestID })
        return
      }
      await ctx.sdk.question.reject(next)
    },
    onCycleVariant: () => {
      if (!state.model || state.variants.length === 0) {
        return {
          status: "no variants available",
        }
      }

      state.activeVariant = cycleVariant(state.activeVariant, state.variants)
      saveVariant(state.model, state.activeVariant)
      return {
        status: state.activeVariant ? `variant ${state.activeVariant}` : "variant default",
        modelLabel: formatModelLabel(state.model, state.activeVariant, state.providers),
        variant: state.activeVariant,
      }
    },
    onModelSelect: async (model) => {
      if (state.model?.providerID === model.providerID && state.model.modelID === model.modelID) {
        return
      }

      state.model = model
      state.activeVariant = undefined
      state.variants = variantsFor(state.providers, model)
      const switching = resolveSavedVariant(model).then((saved) => {
        const current = state.model
        if (!current || current.providerID !== model.providerID || current.modelID !== model.modelID) {
          return
        }

        state.activeVariant = resolveVariant(ctx.variant, undefined, saved, state.variants)
      })
      state.switching = switching
      await switching
      if (state.switching === switching) {
        state.switching = undefined
      }

      const current = state.model
      if (!current || current.providerID !== model.providerID || current.modelID !== model.modelID) {
        return
      }

      return {
        modelLabel: formatModelLabel(model, state.activeVariant, state.providers),
        status: `model ${model.modelID}`,
        variant: state.activeVariant,
        variants: state.variants,
      }
    },
    onVariantSelect: async (variant) => {
      if (!state.model || state.variants.length === 0) {
        return {
          status: "no variants available",
        }
      }

      if (variant && !state.variants.includes(variant)) {
        return {
          status: `variant ${variant} unavailable`,
        }
      }

      state.activeVariant = variant
      saveVariant(state.model, state.activeVariant)
      return {
        status: state.activeVariant ? `variant ${state.activeVariant}` : "variant default",
        modelLabel: formatModelLabel(state.model, state.activeVariant, state.providers),
        variant: state.activeVariant,
        variants: state.variants,
      }
    },
    onInterrupt: () => {
      if (!hasSession(input, state) || state.aborting) {
        return
      }

      state.aborting = true
      void (ctx.native ? ctx.native.interrupt(state.sessionID) : ctx.sdk.session.abort({ sessionID: state.sessionID }))
        .catch(() => {})
        .finally(() => {
          state.aborting = false
        })
    },
    onBackground: () => {
      if (!hasSession(input, state)) return
      void ctx.sdk.experimental.session.background({ sessionID: state.sessionID }).catch(() => {})
    },
    goalActions: goalActions(
      ctx.sdk,
      async () => {
        await ensureSession()
        if (!state.sessionID) throw new Error("Session is unavailable")
        return state.sessionID
      },
      async () => {
        if (state.model)
          return {
            agent: state.agent ?? "build",
            model: { id: state.model.modelID, providerID: state.model.providerID, variant: state.activeVariant },
          }
        await ensureSession()
        if (ctx.native) {
          const current = state.sessionID ? await ctx.native.get(state.sessionID) : undefined
          return current?.model ? { agent: state.agent ?? current.agent ?? "build", model: current.model } : undefined
        }
        if (state.sessionID) {
          const current = (await ctx.sdk.session.get({ sessionID: state.sessionID }, { throwOnError: true })).data
          if (current.model) return { agent: state.agent ?? current.agent ?? "build", model: current.model }
        }
        const configured = (await ctx.sdk.config.get({}, { throwOnError: true })).data.model
        const separator = configured?.indexOf("/") ?? -1
        if (configured && separator > 0)
          return {
            agent: state.agent ?? "build",
            model: {
              providerID: configured.slice(0, separator),
              id: configured.slice(separator + 1),
              variant: state.activeVariant,
            },
          }
      },
      async () => (ctx.native ? "native" : "compatibility"),
    ),
    pluginsActions: pluginsActions(ctx.sdk, ctx.directory),
    mcpActions: mcpActions(ctx.sdk, ctx.directory, () => state.sessionID),
    browserActions,
    computerActions,
    workflowActions: workflowActions(
      ctx.sdk,
      async () => {
        await ensureSession()
        if (!state.sessionID) throw new Error("Session is unavailable")
        return state.sessionID
      },
      () =>
        state.model
          ? {
              agent: state.agent ?? "build",
              model: { id: state.model.modelID, providerID: state.model.providerID, variant: state.activeVariant },
            }
          : undefined,
    ),
    sideQuestionActions: {
      list: async (signal) => {
        await ensureSession()
        return (
          await (ctx.native ? ctx.sdk.v2.sideQuestion : ctx.sdk.sideQuestion).list(
            { sessionID: state.sessionID },
            { signal, throwOnError: true },
          )
        ).data
      },
      ask: async (sideQuestionInput, signal) => {
        await ensureSession()
        return (
          await (ctx.native ? ctx.sdk.v2.sideQuestion : ctx.sdk.sideQuestion).ask(
            { sessionID: state.sessionID, sideQuestionInput },
            { signal, throwOnError: true },
          )
        ).data
      },
      cancel: async (questionID, signal) =>
        (
          await (ctx.native ? ctx.sdk.v2.sideQuestion : ctx.sdk.sideQuestion).cancel(
            { sessionID: state.sessionID, questionID },
            { signal, throwOnError: true },
          )
        ).data,
    },
    commandSandboxActions: {
      get: async (signal) =>
        state.sessionID
          ? (await ctx.sdk.v2.session.sandbox({ sessionID: state.sessionID }, { signal, throwOnError: true })).data
          : undefined,
    },
    hooksActions: {
      trust: async (hostHooksRepositoryTrust, signal) => {
        await ensureSession()
        return (
          await (ctx.native ? ctx.sdk.v2.hooks : ctx.sdk.hooks).trust(
            {
              sessionID: state.sessionID,
              hostHooksRepositoryTrust: {
                root: hostHooksRepositoryTrust.root,
                token: hostHooksRepositoryTrust.token,
                trusted: hostHooksRepositoryTrust.trusted,
              },
            },
            { signal, throwOnError: true },
          )
        ).data
      },
      preference: async (hookID, enabled, signal) => {
        await ensureSession()
        return (
          await (ctx.native ? ctx.sdk.v2.hooks : ctx.sdk.hooks).preference(
            { sessionID: state.sessionID, hostHooksPreference: { hookID, enabled } },
            { signal, throwOnError: true },
          )
        ).data
      },
      get: async (signal) => {
        await ensureSession()
        return (
          await (ctx.native ? ctx.sdk.v2.hooks : ctx.sdk.hooks).get(
            { sessionID: state.sessionID },
            { signal, throwOnError: true },
          )
        ).data
      },
      reload: async (signal) => {
        await ensureSession()
        return (
          await (ctx.native ? ctx.sdk.v2.hooks : ctx.sdk.hooks).reload(
            { sessionID: state.sessionID },
            { signal, throwOnError: true },
          )
        ).data
      },
    },
    feedbackActions: {
      list: async (signal) => {
        await ensureSession()
        return (
          await (ctx.native ? ctx.sdk.v2.feedback : ctx.sdk.feedback).list(
            { sessionID: state.sessionID },
            { signal, throwOnError: true },
          )
        ).data
      },
      save: async (feedbackSave, signal) => {
        await ensureSession()
        return (
          await (ctx.native ? ctx.sdk.v2.feedback : ctx.sdk.feedback).save(
            { sessionID: state.sessionID, feedbackSave },
            { signal, throwOnError: true },
          )
        ).data
      },
      review: async (draftID, revision, signal) =>
        (
          await (ctx.native ? ctx.sdk.v2.feedback : ctx.sdk.feedback).review(
            { sessionID: state.sessionID, draftID, feedbackReview: { revision } },
            { signal, throwOnError: true },
          )
        ).data,
      image: async (draftID, revision, imageID, signal) =>
        (
          await (ctx.native ? ctx.sdk.v2.feedback : ctx.sdk.feedback).image(
            { sessionID: state.sessionID, draftID, imageID, feedbackReview: { revision } },
            { signal, throwOnError: true },
          )
        ).data,
      remove: (draftID, revision, signal) =>
        (ctx.native ? ctx.sdk.v2.feedback : ctx.sdk.feedback).remove(
          { sessionID: state.sessionID, draftID, feedbackReview: { revision } },
          { signal, throwOnError: true },
        ),
    },
    memoryActions: ctx.native
      ? nativeMemoryActions(ctx.sdk, async () => {
          await ensureSession()
          return state.sessionID
        })
      : {
          work: {
            get: async (signal) => {
              await ensureSession()
              return (
                await ctx.sdk.experimental.memory.operation(
                  { sessionID: state.sessionID },
                  { signal, throwOnError: true },
                )
              ).data
            },
            start: async (kind, signal) => {
              await ensureSession()
              return (
                await ctx.sdk.experimental.memory.start(
                  { sessionID: state.sessionID, memoryWorkStart: { kind } },
                  { signal, throwOnError: true },
                )
              ).data
            },
            cancel: async (id, signal) =>
              (
                await ctx.sdk.experimental.memory.cancel(
                  { sessionID: state.sessionID, memoryWorkCancel: { id } },
                  { signal, throwOnError: true },
                )
              ).data,
          },
          review: {
            save: async (content, scope, signal) => {
              await ensureSession()
              return (
                await ctx.sdk.experimental.memory.remember(
                  { sessionID: state.sessionID, memoryReviewSave: { content, scope } },
                  { signal, throwOnError: true },
                )
              ).data
            },
            rewrite: async (content, signal) => {
              await ensureSession()
              return (
                await ctx.sdk.experimental.memory.rewrite(
                  { sessionID: state.sessionID, memoryReviewRewrite: { content } },
                  { signal, throwOnError: true },
                )
              ).data
            },
          },
          health: async (signal) => {
            await ensureSession()
            return (
              await ctx.sdk.experimental.memory.health({ sessionID: state.sessionID }, { throwOnError: true, signal })
            ).data
          },
          status: async (signal) => {
            await ensureSession()
            return (
              await ctx.sdk.experimental.memory.status({ sessionID: state.sessionID }, { throwOnError: true, signal })
            ).data
          },
          toggle: async (enabled, signal) =>
            (
              await ctx.sdk.experimental.memory.toggle(
                { sessionID: state.sessionID, memoryModeUpdate: { enabled } },
                { throwOnError: true, signal },
              )
            ).data,
          list: async (search, signal) => {
            await ensureSession()
            return (
              await ctx.sdk.experimental.memory.list(
                { sessionID: state.sessionID, search },
                { throwOnError: true, signal },
              )
            ).data
          },
          get: async (path, signal) =>
            (
              await ctx.sdk.experimental.memory.get(
                { sessionID: state.sessionID, path },
                { throwOnError: true, signal },
              )
            ).data,
          forget: (note, signal) =>
            ctx.sdk.experimental.memory.forget(
              { sessionID: state.sessionID, memoryNoteForget: note },
              { throwOnError: true, signal },
            ),
        },
    taskActions: {
      messageDraft: (target) =>
        target.source === "native-task"
          ? taskMessageDraft(ctx.sdk, state.sessionID, target.id, target.started_at)
          : undefined,
      get: (target, signal) => tasks.get(target, signal),
      wait: (target, signal) => tasks.wait(target, signal),
      changeSchedule: async (target, action, signal) => {
        const owner = state.sessionID
        const result = await tasks.changeSchedule(target, action, signal)
        if (state.sessionID === owner) await refreshTasks()
        return result
      },
      cancel: async (target, signal) => {
        const owner = state.sessionID
        await tasks.cancel(target, signal)
        if (state.sessionID === owner) await refreshTasks()
      },
    },
    onSubagentSelect: (sessionID) => {
      state.selectSubagent?.(sessionID)
      log?.write("subagent.select", {
        sessionID,
      })
    },
  })
  const footer = shell.footer
  const abort = () => footer.close()
  input.signal?.addEventListener("abort", abort, { once: true })
  if (input.signal?.aborted) abort()
  const taskAbort = new AbortController()
  let taskTimer: ReturnType<typeof setTimeout> | undefined
  let taskRevision = 0
  let taskOwner = state.sessionID
  const refreshTasks = async () => {
    const revision = ++taskRevision
    clearTimeout(taskTimer)
    const sessionID = state.sessionID
    if (taskOwner !== sessionID) {
      taskOwner = sessionID
      footer.event({ type: "stream.patch", patch: { tasks: [], taskError: "", taskIssues: [] } })
    }
    if (sessionID)
      await tasks
        .list(AbortSignal.any([taskAbort.signal, AbortSignal.timeout(10_000)]))
        .then((result) => {
          if (!taskAbort.signal.aborted && revision === taskRevision && state.sessionID === sessionID)
            footer.event({
              type: "stream.patch",
              patch: { tasks: result.items, taskNative: result.native, taskError: "", taskIssues: result.issues },
            })
        })
        .catch((error: unknown) => {
          if (!taskAbort.signal.aborted && revision === taskRevision && state.sessionID === sessionID)
            footer.event({
              type: "stream.patch",
              patch: { taskError: error instanceof Error ? error.message : String(error) },
            })
        })
    if (!taskAbort.signal.aborted && revision === taskRevision) taskTimer = setTimeout(refreshTasks, 2_000)
  }
  void refreshTasks()
  const rememberLocal = (commit: StreamCommit, after?: LocalReplayAnchor) => {
    state.localRows = [...state.localRows, { commit, after }].slice(-LOCAL_REPLAY_ROW_LIMIT)
  }

  const loadCatalog = async (): Promise<void> => {
    if (footer.isClosed) {
      return
    }

    if (ctx.native) {
      const catalog = await ctx.native.catalog()
      if (!footer.isClosed)
        footer.event({
          type: "catalog",
          agents: catalog.agents.map((agent) => ({
            name: agent.id,
            description: agent.description ?? undefined,
            mode: agent.mode,
            hidden: agent.hidden ?? undefined,
            color: agent.color ?? undefined,
            model: agent.model ? { providerID: agent.model.providerID, modelID: agent.model.id } : undefined,
          })),
          resources: [],
          commands: catalog.commands.map((command) => ({
            name: command.name,
            description: command.description ?? undefined,
            template: command.template,
            hints: ["[interval] <prompt>"],
          })),
        })
      return
    }
    const [agents, resources, commands] = await Promise.all([
      ctx.sdk.app
        .agents({ directory: ctx.directory })
        .then((x) => x.data ?? [])
        .catch(() => []),
      ctx.sdk.experimental.resource
        .list({ directory: ctx.directory })
        .then((x) => Object.values(x.data ?? {}))
        .catch(() => []),
      ctx.sdk.command
        .list({ directory: ctx.directory })
        .then((x) => x.data ?? [])
        .catch(() => []),
    ])
    if (footer.isClosed) {
      return
    }

    footer.event({
      type: "catalog",
      agents,
      resources,
      commands,
    })
  }

  void footer
    .idle()
    .then(loadCatalog)
    .catch(() => {})

  if (Flag.APEXO_SHOW_TTFD) {
    footer.append({
      kind: "system",
      text: `startup ${Math.max(0, Math.round(performance.now() - start))}ms`,
      phase: "final",
      source: "system",
    })
  }

  if (input.demo) {
    await ensureSession()
    state.demo = createRunDemo({
      footer,
      sessionID: state.sessionID,
      thinking: input.thinking,
      limits: () => state.limits,
    })
  }

  if (input.afterPaint) {
    void Promise.resolve(input.afterPaint(ctx)).catch(() => {})
  }

  void modelTask.then(async (info) => {
    state.providers = info.providers
    state.limits = info.limits

    if (!state.model) {
      const configured = !ctx.native
        ? await ctx.sdk.config
            .get({ directory: ctx.directory })
            .then((x) => x.data?.model)
            .catch(() => undefined)
        : undefined
      const sep = configured?.indexOf("/") ?? -1
      if (configured && sep > 0) {
        state.model = {
          providerID: configured.slice(0, sep),
          modelID: configured.slice(sep + 1),
        }
      } else {
        const firstProvider = info.providers.find((p) => Object.keys(p.models ?? {}).length > 0)
        const firstModelID = firstProvider ? Object.keys(firstProvider.models ?? {})[0] : undefined
        if (firstProvider && firstModelID) {
          state.model = {
            providerID: firstProvider.id,
            modelID: firstModelID,
          }
        }
      }
    }
    state.variants = variantsFor(state.providers, state.model)

    const next = resolveVariant(ctx.variant, session.variant, savedVariant, state.variants)
    if (next !== state.activeVariant) {
      state.activeVariant = next
    }

    if (footer.isClosed) {
      return
    }

    footer.event({ type: "models", providers: info.providers })
    footer.event({ type: "variants", variants: state.variants, current: state.activeVariant })
    if (!state.model) {
      return
    }

    footer.event({
      type: "model",
      model: formatModelLabel(state.model, state.activeVariant, state.providers),
    })
  })

  const streamTask = deps.streamTransport ?? import("./stream.transport")
  const ensureStream = () => {
    if (state.stream) {
      return state.stream
    }

    // Share eager prewarm and first-turn boot through one in-flight promise,
    // but clear it if transport creation fails so a later prompt can retry.
    const next = (async () => {
      await ensureSession()
      if (footer.isClosed) {
        throw new Error("runtime closed")
      }

      const mod = await streamTask
      if (footer.isClosed) {
        throw new Error("runtime closed")
      }

      const handle = await mod.createSessionTransport({
        sdk: ctx.sdk,
        native: ctx.native,
        onSelection: (session) => {
          state.agent = session.agent ?? undefined
          state.model = session.model ? { modelID: session.model.id, providerID: session.model.providerID } : undefined
          state.activeVariant = session.model?.variant ?? undefined
          footer.event({
            type: "stream.patch",
            patch: {
              agent: state.agent,
              model: state.model ? formatModelLabel(state.model, state.activeVariant, state.providers) : "",
            },
          })
        },
        directory: ctx.directory,
        sessionID: state.sessionID,
        thinking: input.thinking,
        replay: input.replay,
        replayLimit: input.replayLimit,
        limits: () => state.limits,
        providers: () => state.providers,
        footer,
        trace: log,
      })
      if (footer.isClosed) {
        await handle.close()
        throw new Error("runtime closed")
      }

      state.selectSubagent = (sessionID) => handle.selectSubagent(sessionID)
      return { mod, handle }
    })()
    state.stream = next
    void next.catch(() => {
      if (state.stream === next) {
        state.stream = undefined
      }
    })
    return next
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  const offResize = shell.onResize(() => {
    if (resizeTimer) {
      clearTimeout(resizeTimer)
    }

    resizeTimer = setTimeout(() => {
      resizeTimer = undefined
      if (footer.isClosed) {
        return
      }

      shell.refreshTheme()
      if (!input.replay || !state.stream) {
        return
      }

      void state.stream
        .then((item) =>
          item.handle.replayOnResize({
            localRows: () => state.localRows,
            reset: () =>
              shell.resetForReplay({
                sessionTitle: state.sessionTitle,
                sessionID: state.sessionID,
                history: state.history,
              }),
          }),
        )
        .catch(() => {})
    }, RESIZE_DELAY)
  })

  const runQueue = async () => {
    let includeFiles = true
    if (state.demo) {
      await state.demo.start()
    }

    const mod = await import("./runtime.queue")
    const createSession = input.createSession
    await mod.runPromptQueue({
      footer,
      initialInput: input.initialInput,
      trace: log,
      getSessionID: () => state.sessionID,
      onSend: (prompt) => {
        state.shown = true
        state.history.push(prompt)
        if (prompt.mode !== "shell") {
          rememberLocal({
            kind: "user",
            text: prompt.text,
            phase: "start",
            source: "system",
            messageID: prompt.messageID,
          })
        }
      },
      onNewSession: createSession
        ? async () => {
            try {
              await state.switching?.catch(() => {})
              const created = await createSession(ctx, {
                agent: state.agent,
                model: state.model,
                variant: state.activeVariant,
              })
              await footer.idle().catch(() => {})
              await state.stream?.then((item) => item.handle.close()).catch(() => {})
              state.stream = undefined
              state.session = undefined
              state.selectSubagent = undefined
              state.shown = false
              state.sessionID = created.sessionID
              state.sessionTitle = created.sessionTitle
              state.agent = created.agent ?? state.agent
              state.history = []
              state.localRows = []
              includeFiles = true
              state.demo = input.demo
                ? createRunDemo({
                    footer,
                    sessionID: state.sessionID,
                    thinking: input.thinking,
                    limits: () => state.limits,
                  })
                : undefined
              log?.write("session.new", {
                sessionID: state.sessionID,
              })
              footer.event({
                type: "stream.subagent",
                state: {
                  tabs: [],
                  details: {},
                  permissions: [],
                  questions: [],
                },
              })
              footer.event({ type: "stream.view", view: { type: "prompt" } })
              footer.event({
                type: "stream.patch",
                patch: {
                  phase: "idle",
                  duration: "",
                  usage: "",
                  first: true,
                },
              })
              footer.append({
                kind: "system",
                text: `new session ${state.sessionID}`,
                phase: "final",
                source: "system",
              })
              await state.demo?.start()
            } catch (error) {
              footer.event({
                type: "stream.patch",
                patch: {
                  phase: "idle",
                  status: "failed to start new session",
                },
              })
              const commit = {
                kind: "error",
                text: error instanceof Error ? error.message : String(error),
                phase: "start",
                source: "system",
                messageID: MessageID.ascending(),
              } as const
              rememberLocal(commit)
              footer.append(commit)
            }
          }
        : undefined,
      run: async (prompt, signal) => {
        if (state.demo && (await state.demo.prompt(prompt, signal))) {
          return
        }

        await state.switching?.catch(() => {})

        let outputAnchor: LocalReplayAnchor | undefined
        try {
          const next = await ensureStream()
          await next.handle.runPromptTurn({
            agent: state.agent,
            model: state.model,
            variant: state.activeVariant,
            prompt,
            files: input.files,
            includeFiles,
            onVisibleOutput: (anchor) => {
              outputAnchor = anchor
            },
            signal,
          })
          if (prompt.messageID) {
            state.localRows = state.localRows.filter(
              (row) => row.commit.kind !== "user" || row.commit.messageID !== prompt.messageID,
            )
          }
          includeFiles = false
        } catch (error) {
          if (signal.aborted || footer.isClosed) {
            return
          }

          const text =
            (await state.stream?.then((item) => item.mod).catch(() => undefined))?.formatUnknownError(error) ??
            (error instanceof Error ? error.message : String(error))
          const commit = {
            kind: "error",
            text,
            phase: "start",
            source: "system",
            messageID: prompt.messageID,
          } as const
          rememberLocal(commit, outputAnchor)
          footer.append(commit)
        }
      },
    })
  }

  try {
    const eager = eagerStream(input, ctx)
    if (eager) {
      if (input.replay && state.shown) {
        // Replay commits immutable scrollback rows, so wait for provider names
        // before bootstrapping existing session history.
        await modelTask
      }

      await ensureStream()
    }

    if (!eager && input.resolveSession) {
      queueMicrotask(() => {
        if (footer.isClosed) {
          return
        }

        void ensureStream().catch(() => {})
      })
    }

    if (input.startupNotice) {
      const commit = { kind: "system", text: input.startupNotice, phase: "final", source: "system" } as const
      rememberLocal(commit)
      footer.append(commit)
    }

    try {
      await runQueue()
    } finally {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      offResize()
      await state.stream?.then((item) => item.handle.close()).catch(() => {})
    }
  } finally {
    input.signal?.removeEventListener("abort", abort)
    taskAbort.abort()
    clearTimeout(taskTimer)
    const title = await resolveExitTitle(ctx, input, state)

    await shell.close({
      showExit: state.shown && hasSession(input, state),
      sessionTitle: title,
      sessionID: state.sessionID,
      history: state.history,
    })
  }
}

// Local in-process mode. Creates an SDK client backed by a direct fetch to
// the in-process server, so no external HTTP server is needed.
export async function runInteractiveLocalMode(input: RunLocalInput): Promise<void> {
  const sdk = createApexoClient({
    baseUrl: "http://apexo.internal",
    fetch: input.fetch,
    directory: input.directory,
  })
  let session: Promise<ResolvedSession> | undefined

  return runInteractiveRuntime({
    files: input.files,
    initialInput: input.initialInput,
    thinking: input.thinking,
    backgroundSubagents: input.backgroundSubagents,
    replay: input.replay,
    replayLimit: input.replayLimit,
    demo: input.demo,
    resolveSession: () => {
      if (session) {
        return session
      }

      session = Promise.all([input.resolveAgent(), input.session(sdk)]).then(([agent, next]) => {
        if (!next?.id) {
          throw new Error("Session not found")
        }

        return {
          sessionID: next.id,
          sessionTitle: next.title,
          agent,
        }
      })
      return session
    },
    createSession: createSessionResolver(input.createSession),
    boot: async () => {
      return {
        sdk,
        directory: input.directory,
        sessionID: "",
        sessionTitle: undefined,
        resume: false,
        agent: input.agent,
        model: input.model,
        variant: input.variant,
      }
    },
  })
}

// Attach mode. Uses the caller-provided SDK client directly.
export async function runInteractiveMode(
  input: RunInput & { createSession?: CreateSession; signal?: AbortSignal },
  deps?: RunRuntimeDeps,
): Promise<void> {
  return runInteractiveRuntime(
    {
      signal: input.signal,
      startupNotice: input.startupNotice,
      files: input.files,
      initialInput: input.initialInput,
      thinking: input.thinking,
      backgroundSubagents: input.backgroundSubagents,
      replay: input.replay,
      replayLimit: input.replayLimit,
      demo: input.demo,
      boot: async () => ({
        sdk: input.sdk,
        native: input.native,
        directory: input.directory,
        sessionID: input.sessionID,
        sessionTitle: input.sessionTitle,
        resume: input.resume,
        agent: input.agent,
        model: input.model,
        variant: input.variant,
      }),
      createSession: createSessionResolver(input.createSession),
    },
    deps,
  )
}
