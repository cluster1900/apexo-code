import { expect, test } from "bun:test"
import { Deferred, Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { BackgroundJob } from "@apexo/core/background-job"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { createExtensions } from "@/tool/grok-build-extensions"
import { GrokBuildMedia } from "@/tool/grok-build-media"
import { Tool } from "@/tool/tool"
import { SessionID, MessageID } from "@/session/schema"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const context: Tool.Context = {
  sessionID: SessionID.make("ses_extensions"),
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  metadata: () => Effect.void,
  ask: () => Effect.void,
  messages: [],
}
const it = testEffect(Layer.empty)

;[0, 7].forEach((exit) => {
  it.effect(`monitor flushes its final partial line with exit status ${exit}`, () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.make
      const notifications: Tool.BackgroundNotification[] = []
      const shell: Tool.Def = {
        id: "bash",
        description: "final output source",
        parameters: Schema.Unknown,
        execute: (_, ctx) =>
          Effect.gen(function* () {
            if (ctx.onOutput) yield* ctx.onOutput("final partial line")
            return { title: "exit", metadata: { exit }, output: "final partial line" }
          }),
      }
      const monitor = createExtensions({ shell, background: jobs }).find((tool) => tool.id === "monitor")!
      const started = yield* monitor.execute(
        { command: "final", description: "final output" },
        {
          ...context,
          notifyBackground: (event) =>
            Effect.sync(() => {
              notifications.push(event)
            }),
        },
      )
      yield* jobs.wait({ id: String(started.metadata.task_id) })
      expect(notifications).toHaveLength(1)
      expect(notifications[0]?.status).toBe(exit ? "error" : "completed")
      expect(notifications[0]?.output).toBe("final partial line")
      expect(notifications[0]?.exit).toBe(exit)
    }),
  )
})

it.effect("monitor pipeline aborts sustained overload and reports why it stopped", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const notifications: Tool.BackgroundNotification[] = []
    const shell: Tool.Def = {
      id: "bash",
      description: "continuous output source",
      parameters: Schema.Unknown,
      execute: (_, ctx) =>
        Effect.gen(function* () {
          while (!ctx.abort.aborted) {
            if (ctx.onOutput) yield* ctx.onOutput("noisy event\n".repeat(20))
            if (!ctx.abort.aborted) yield* Effect.sleep(1_000)
          }
          return { title: "stopped", metadata: { exit: null }, output: "stopped" }
        }),
    }
    const monitor = createExtensions({ shell, background: jobs }).find((tool) => tool.id === "monitor")!
    const started = yield* monitor.execute(
      { command: "continuous", description: "overload", persistent: true },
      {
        ...context,
        notifyBackground: (event) =>
          Effect.sync(() => {
            notifications.push(event)
          }),
      },
    )
    yield* TestClock.adjust(31_000)
    const result = yield* jobs.wait({ id: String(started.metadata.task_id) })
    expect(result.info?.status).toBe("completed")
    expect(result.info?.metadata?.rateLimited).toBe(true)
    expect(notifications.at(-1)?.status).toBe("error")
    expect(notifications.at(-1)?.output).toContain("Monitor stopped")
  }),
)

it.effect("one-shot scheduler settles and is absent from the active list", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const task: Tool.Def = {
      id: "task",
      description: "task",
      parameters: Schema.Unknown,
      execute: () => Effect.succeed({ title: "done", metadata: {}, output: "one shot" }),
    }
    const tools = createExtensions({ background: jobs, task })
    const result = yield* tools
      .find((tool) => tool.id === "scheduler_create")!
      .execute({ interval: "1m", prompt: "once", recurring: false }, context)
    yield* TestClock.adjust("1 minute")
    const completed = yield* jobs.wait({ id: String(result.metadata.task_id) })
    expect(completed?.info?.status).toBe("completed")
    expect(completed?.info?.output).toBe("one shot")
    expect((yield* tools.find((tool) => tool.id === "scheduler_list")!.execute({}, context)).metadata.count).toBe(0)
  }),
)

test("media checks external-directory and read permissions before uploading local references", async () => {
  await using workspace = await tmpdir()
  await using external = await tmpdir()
  const image = `${external.path}/private.png`
  await Bun.write(image, "private image")
  const permissions: string[] = []
  const tool = GrokBuildMedia.tools({ key: Effect.succeed("test-key") })[1]
  await expect(
    Effect.runPromise(
      tool.execute(
        { image },
        {
          ...context,
          extra: { directory: workspace.path },
          ask: (input) => {
            permissions.push(input.permission)
            return input.permission === "read" ? Effect.die(new Error("read denied")) : Effect.void
          },
        },
      ),
    ),
  ).rejects.toThrow("read denied")
  expect(permissions).toEqual(["image_to_video", "edit", "external_directory", "read"])
})

it.effect("scheduler permits the first fire at the seven-day expiry boundary", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const task: Tool.Def = {
      id: "task",
      description: "task",
      parameters: Schema.Unknown,
      execute: () => Effect.succeed({ title: "done", metadata: {}, output: "seven days" }),
    }
    const create = createExtensions({
      background: {
        ...jobs,
        start: (input) => jobs.start({ ...input, run: Effect.sleep(1).pipe(Effect.andThen(input.run)) }),
      },
      task,
    }).find((tool) => tool.id === "scheduler_create")!
    const result = yield* create.execute({ interval: "7d", prompt: "once", recurring: false }, context)
    yield* TestClock.adjust("7 days")
    const completed = yield* jobs.wait({ id: String(result.metadata.task_id) })
    expect(completed?.info?.status).toBe("completed")
    expect(completed?.info?.output).toBe("seven days")
  }),
)

it.effect("scheduler clamps short positive intervals, rejects zero and expires intervals beyond its lifetime", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const fired: string[] = []
    const task: Tool.Def = {
      id: "task",
      description: "check",
      parameters: Schema.Unknown,
      execute: () =>
        Effect.sync(() => {
          fired.push("fire")
          return { title: "done", metadata: {}, output: "done" }
        }),
    }
    const create = createExtensions({ background: jobs, task }).find((tool) => tool.id === "scheduler_create")!
    const short = yield* create.execute({ interval: "1s", prompt: "short" }, context)
    expect(short.metadata.interval).toBe("60s")
    yield* jobs.cancel(String(short.metadata.task_id))
    const invalid = yield* create.execute({ interval: "0m", prompt: "zero" }, context)
    expect(invalid.metadata.status).toBe("invalid_request")
    const long = yield* create.execute({ interval: "8d", prompt: "long" }, context)
    expect(long.metadata.interval).toBe("691200s")
    yield* TestClock.adjust("7 days")
    expect((yield* jobs.get(String(long.metadata.task_id)))?.status).toBe("completed")
    expect(fired).toEqual([])
  }),
)

test("workspace memory retains concurrent notes, deduplicates and survives reload", async () => {
  await using home = await tmpdir()
  await using dir = await tmpdir()
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      WorkspaceMemory.update(dir.path, { operation: "remember", content: `note ${index}` }, home.path),
    ),
  )
  const saved = await WorkspaceMemory.update(dir.path, { operation: "remember", content: "note 0" }, home.path)
  expect(saved.match(/note 0/g)).toHaveLength(1)
  expect(saved.match(/note /g)).toHaveLength(8)
  expect(await WorkspaceMemory.read(dir.path, home.path)).toBe(saved)
  expect(await WorkspaceMemory.read(`${dir.path}/other`, home.path)).toBe("")
})

it.effect("scheduler fires repeatedly with current next-fire metadata and cancellation", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const fired = yield* Deferred.make<void>()
    const task: Tool.Def = {
      id: "task",
      description: "task",
      parameters: Schema.Unknown,
      execute: () =>
        Deferred.succeed(fired, undefined).pipe(Effect.as({ title: "done", metadata: {}, output: "checked" })),
    }
    const tools = createExtensions({ background: jobs, task })
    const create = tools.find((tool) => tool.id === "scheduler_create")!
    const result = yield* create.execute({ interval: "1m", prompt: "check" }, context)
    const id = String(result.metadata.task_id)
    yield* TestClock.adjust("1 minute")
    yield* Deferred.await(fired)
    const running = yield* jobs.get(id)
    expect(running?.status).toBe("running")
    yield* tools.find((tool) => tool.id === "scheduler_delete")!.execute({ task_id: id }, context)
    expect((yield* jobs.get(id))?.status).toBe("cancelled")
  }),
)

it.effect("scheduler delivers each fire result, including failures, without polling", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const notices: Tool.BackgroundNotification[] = []
    const task: Tool.Def = {
      id: "task",
      description: "scheduled check",
      parameters: Schema.Unknown,
      execute: () =>
        Effect.suspend(() =>
          notices.length === 0
            ? Effect.die(new Error("first check failed"))
            : Effect.succeed({ title: "done", metadata: {}, output: "recovered" }),
        ),
    }
    const create = createExtensions({ background: jobs, task }).find((tool) => tool.id === "scheduler_create")!
    const started = yield* create.execute(
      { interval: "1m", prompt: "check" },
      {
        ...context,
        notifyBackground: (notice) =>
          Effect.sync(() => {
            notices.push(notice)
          }),
      },
    )
    yield* TestClock.adjust(120_000)
    expect(notices.map((notice) => notice.status)).toEqual(["error", "completed"])
    expect(notices[0]?.output).toContain("first check failed")
    expect(notices[1]?.output).toBe("recovered")
    expect(notices.every((notice) => notice.taskID === started.metadata.task_id && notice.type === "scheduler")).toBe(
      true,
    )
    yield* jobs.cancel(String(started.metadata.task_id))
  }),
)

it.effect("invalid or denied schedule updates preserve the running task", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const task: Tool.Def = {
      id: "task",
      description: "task",
      parameters: Schema.Unknown,
      execute: () => Effect.succeed({ title: "done", metadata: {}, output: "ok" }),
    }
    const create = createExtensions({ background: jobs, task }).find((tool) => tool.id === "scheduler_create")!
    const result = yield* create.execute({ interval: "1m", prompt: "check" }, context)
    const id = String(result.metadata.task_id)
    const invalid = yield* create.execute({ task_id: id, interval: "wrong", prompt: "other" }, context)
    expect(invalid.metadata.status).toBe("invalid_request")
    const denied = yield* create
      .execute({ task_id: id, prompt: "other" }, { ...context, ask: () => Effect.die("denied") })
      .pipe(Effect.exit)
    expect(denied._tag).toBe("Failure")
    expect((yield* jobs.get(id))?.status).toBe("running")
    expect((yield* jobs.get(id))?.metadata?.prompt).toBe("check")
    expect((yield* create.execute({ interval: "1m", prompt: "check", durable: true }, context)).metadata.status).toBe(
      "invalid_request",
    )
  }),
)

it.effect("monitor retains shell permissions and exposes output while running", () =>
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.make
    const ready = yield* Deferred.make<void>()
    const permissions: string[] = []
    const shell: Tool.Def = {
      id: "bash",
      description: "shell",
      parameters: Schema.Unknown,
      execute: (_, ctx) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "bash", patterns: ["watch"], always: [], metadata: {} })
          yield* ctx.metadata({ metadata: { output: "first line" } })
          yield* Deferred.succeed(ready, undefined)
          return yield* Effect.never
        }),
    }
    const monitor = createExtensions({ background: jobs, shell }).find((tool) => tool.id === "monitor")!
    const result = yield* monitor.execute(
      { command: "watch", description: "test", persistent: true },
      {
        ...context,
        ask: (input) =>
          Effect.sync(() => {
            permissions.push(input.permission)
          }),
      },
    )
    yield* Deferred.await(ready)
    const job = yield* jobs.get(String(result.metadata.task_id))
    expect(permissions).toEqual(["monitor", "bash"])
    expect(job?.output).toBe("first line")
    yield* jobs.cancel(job!.id)
    expect((yield* jobs.get(job!.id))?.status).toBe("cancelled")
  }),
)

test("image/video tools use the xAI wire schema, save files and return preview attachments", async () => {
  await using dir = await tmpdir()
  const calls: { path: string; body: unknown; auth: string | null }[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      calls.push({
        path: pathname,
        body: request.method === "POST" ? await request.json() : undefined,
        auth: request.headers.get("authorization"),
      })
      if (pathname === "/images/generations") return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] })
      if (pathname === "/videos/generations") return Response.json({ request_id: "video-1" })
      if (pathname === "/videos/video-1")
        return Response.json({ status: "done", video: { url: new URL("/asset.mp4", request.url).href } })
      return new Response("video-bytes")
    },
  })
  try {
    const tools = GrokBuildMedia.tools({ key: Effect.succeed("test-key"), baseURL: server.url.href, pollMs: 1 })
    const ctx = { ...context, extra: { directory: dir.path } }
    const image = await Effect.runPromise(tools[0].execute({ prompt: "small test" }, ctx))
    expect(image.metadata.status).toBe("completed")
    expect(calls[0]?.body).toMatchObject({ aspect_ratio: "auto", resolution: "1k" })
    expect(image.attachments?.[0].mime).toBe("image/png")
    expect(await Bun.file(String(image.metadata.path)).exists()).toBe(true)
    const video = await Effect.runPromise(tools[1].execute({ image: String(image.metadata.path), duration: 6 }, ctx))
    expect(video.metadata.status).toBe("completed")
    expect(video.attachments?.[0].mime).toBe("video/mp4")
    expect(await Bun.file(String(video.metadata.path)).text()).toBe("video-bytes")
    const reference = await Effect.runPromise(
      tools[2].execute(
        {
          prompt: "test",
          images: ["https://example.com/ref.png"],
          voices: ["eve"],
          first_frame: String(image.metadata.path),
          aspect_ratio: "16:9",
          keyframes: [{ image: String(image.metadata.path), timestamp_s: 3 }],
          duration: 6,
        },
        ctx,
      ),
    )
    expect(reference.metadata.status).toBe("completed")
    expect(calls.filter((call) => call.path === "/videos/generations").at(-1)?.body).toMatchObject({
      reference_images: [{ url: "https://example.com/ref.png" }],
      reference_audios: [{ voice_id: "eve" }],
      image: { url: expect.stringContaining("data:image/png") },
      aspect_ratio: "16:9",
      keyframes: [{ image: { url: expect.any(String) }, timestamp_s: 3 }],
    })
    expect(calls.filter((call) => call.path === "/asset.mp4").every((call) => call.auth === null)).toBe(true)
  } finally {
    server.stop(true)
  }
})

test("media cancellation stops polling and does not save a file", async () => {
  await using dir = await tmpdir()
  const controller = new AbortController()
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      if (request.method === "POST") return Response.json({ request_id: "pending" })
      controller.abort()
      return Response.json({ status: "pending" })
    },
  })
  try {
    const tool = GrokBuildMedia.tools({ key: Effect.succeed("test-key"), baseURL: server.url.href, pollMs: 1 })[1]
    const result = await Effect.runPromise(
      tool.execute(
        { image: "data:image/png;base64,iVBORw0KGgo=" },
        { ...context, abort: controller.signal, extra: { directory: dir.path } },
      ),
    )
    expect(result.metadata.status).toBe("error")
    expect(result.attachments).toBeUndefined()
  } finally {
    server.stop(true)
  }
})
