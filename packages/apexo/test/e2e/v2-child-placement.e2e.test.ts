import { expect } from "bun:test"
import { mkdir, realpath, readFile, rm } from "node:fs/promises"
import { Task } from "@apexo/schema/task"
import { Workflow } from "@apexo/schema/workflow"
import { Effect, Layer, Schema } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionMessage } from "@apexo/core/session/message"
import { createRoutes } from "@apexo/server/routes"
import { TestInstance } from "../fixture/fixture"
import { reply, TestLLMServer } from "../lib/llm-server"
import { pollWithTimeout, testEffect } from "../lib/effect"
import path from "node:path"

const served = HttpRouter.serve(createRoutes(), { disableListenLog: true, disableLogger: true })
const it = testEffect(
  Layer.mergeAll(
    served.pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provide(layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
    TestLLMServer.layer,
  ),
)
const SessionResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
const MessagesResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Message) })
const post = (url: string, body: unknown) =>
  HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))

const configure = (directory: string, url: string) =>
  Effect.promise(() =>
    Bun.write(
      path.join(directory, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        goal: { summary_enabled: false },
        task: { activeMessages: true },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        agents: {
          helper: {
            mode: "subagent",
            model: "task-fixture/saved",
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          },
          other: { mode: "subagent", model: "task-fixture/override" },
        },
        providers: {
          "task-fixture": {
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: url, settings: { apiKey: "test" } },
            models: Object.fromEntries(
              ["model", "saved", "override"].map((id) => [
                id,
                {
                  name: id,
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              ]),
            ),
          },
        },
      }),
    ),
  )

const history = (id: string) =>
  HttpClient.get(`/api/session/${id}/message?order=asc`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
    Effect.map((value) => value.data),
  )

for (const mode of ["cwd", "worktree"] as const) {
  it.instance(
    `Task ${mode} executes in owned placement and resumes the retained workspace`,
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const llm = yield* TestLLMServer
        const directory = yield* Effect.promise(() => realpath(instance.directory))
        yield* Effect.promise(() => Bun.write(path.join(directory, "tracked.txt"), "COMMITTED"))
        for (const args of [
          ["init"],
          ["add", "tracked.txt"],
          ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "base"],
        ]) {
          const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd: directory })
          expect(result.exitCode).toBe(0)
        }
        yield* configure(directory, llm.url)
        const target = path.join(directory, "alternate")
        yield* Effect.promise(() => mkdir(target))
        yield* Effect.promise(() => Bun.write(path.join(directory, "tracked.txt"), "DIRTY_PARENT"))
        yield* Effect.promise(() => Bun.write(path.join(directory, "untracked.txt"), "UNTRACKED_PARENT"))
        yield* Effect.promise(() => Bun.write(path.join(target, "tracked.txt"), "EXPLICIT_CWD"))
        yield* Effect.promise(() => Bun.write(path.join(target, "untracked.txt"), "EXPLICIT_UNTRACKED"))
        const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(
          yield* (yield* post("/api/session", {
            commandSandbox: "workspace",
            location: { directory },
            model: { providerID: "task-fixture", id: "model" },
            agent: "build",
          })).json,
        )).data
        const source = { id: "", directory: "" }
        const requests: string[] = []
        yield* llm.respond(() =>
          reply()
            .tool("task", {
              description: "Placement source",
              prompt: "PLACEMENT_SOURCE",
              subagent_type: "helper",
              ...(mode === "cwd" ? { cwd: "alternate" } : { isolation: "worktree" }),
            })
            .item(),
        )
        yield* llm.respond(() =>
          reply()
            .tool("bash", {
              command: `pwd; cat tracked.txt untracked.txt; printf CHILD_EDIT > child.txt; (printf BAD > '${directory}/parent-escape.txt') 2>/dev/null && echo PARENT_WRITE_ESCAPED || echo PARENT_WRITE_DENIED; (printf BAD > .git) 2>/dev/null && echo GIT_WRITE_ESCAPED || echo GIT_WRITE_DENIED; /usr/bin/curl --connect-timeout 1 --max-time 2 -s ${llm.url} >/dev/null 2>&1 && echo NETWORK_ESCAPED || echo NETWORK_DENIED`,
              description: "Inspect native placement",
            })
            .item(),
        )
        yield* llm.respond((hit) => {
          requests.push(JSON.stringify(hit.body.messages))
          return reply().text("PLACEMENT_SOURCE_DONE").stop().item()
        })
        yield* llm.respond(() => reply().text("PARENT_SOURCE_DONE").stop().item())
        expect((yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Create placement" } })).status).toBe(
          200,
        )
        yield* pollWithTimeout(
          history(parent.id).pipe(
            Effect.map((items) =>
              items.some(
                (item) =>
                  item.type === "assistant" &&
                  item.content.some((part) => part.type === "text" && part.text === "PARENT_SOURCE_DONE"),
              )
                ? true
                : undefined,
            ),
          ),
          "Source parent did not settle",
          "20 seconds",
        ).pipe(
          Effect.tapError(() =>
            history(parent.id).pipe(
              Effect.flatMap((items) =>
                Effect.sync(() => console.error("Placement source history", JSON.stringify(items))),
              ),
            ),
          ),
        )
        const first = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
        )
        expect(first).toHaveLength(1)
        expect(first[0].status).toBe("completed")
        source.id = first[0].id
        const child = yield* HttpClient.get(`/api/session/${source.id}`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({ data: Schema.Struct({ location: Schema.Struct({ directory: Schema.String }) }) }),
            ),
          ),
        )
        source.directory = child.data.location.directory
        const detail = yield* HttpClient.get(`/api/session/${parent.id}/task/${source.id}`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Task.Detail)),
        )
        expect(detail.worktreePath).toBe(mode === "worktree" ? source.directory : undefined)
        expect(source.directory).not.toBe(directory)
        if (mode === "cwd") expect(source.directory).toBe(target)
        expect(requests[0]).toContain(mode === "cwd" ? "EXPLICIT_CWD" : "DIRTY_PARENT")
        expect(requests[0]).toContain(mode === "cwd" ? "EXPLICIT_UNTRACKED" : "UNTRACKED_PARENT")
        for (const denied of ["PARENT_WRITE_DENIED", "GIT_WRITE_DENIED", "NETWORK_DENIED"])
          expect(requests[0]).toContain(denied)
        expect(yield* Effect.promise(() => Bun.file(path.join(directory, "parent-escape.txt")).exists())).toBe(false)
        expect(yield* Effect.promise(() => readFile(path.join(source.directory, "child.txt"), "utf8"))).toBe(
          "CHILD_EDIT",
        )
        expect(yield* Effect.promise(() => Bun.file(path.join(directory, "child.txt")).exists())).toBe(false)
        yield* llm.respond(() =>
          reply()
            .tool("task", {
              description: "Placement resume",
              prompt: "PLACEMENT_NEXT",
              subagent_type: "other",
              resume_from: source.id,
              cwd: "/missing-ignored-resume-cwd",
            })
            .item(),
        )
        yield* llm.respond(() =>
          reply().tool("bash", { command: "pwd; cat child.txt", description: "Read retained edit" }).item(),
        )
        yield* llm.respond((hit) => {
          requests.push(JSON.stringify(hit.body.messages))
          return reply().text("PLACEMENT_RESUMED").stop().item()
        })
        yield* llm.respond(() => reply().text("PARENT_RESUME_DONE").stop().item())
        expect((yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Resume placement" } })).status).toBe(
          200,
        )
        yield* pollWithTimeout(
          history(parent.id).pipe(
            Effect.map((items) =>
              items.some(
                (item) =>
                  item.type === "assistant" &&
                  item.content.some((part) => part.type === "text" && part.text === "PARENT_RESUME_DONE"),
              )
                ? true
                : undefined,
            ),
          ),
          "Resumed parent did not settle",
          "20 seconds",
        )
        const after = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
        )
        expect(after).toHaveLength(2)
        expect(after.every((item) => item.status === "completed")).toBe(true)
        expect(requests[1]).toContain("CHILD_EDIT")
        expect(requests[1]).toContain(source.directory)
        expect(yield* llm.calls).toBe(8)
        if (mode === "worktree") yield* Effect.promise(() => rm(source.directory, { recursive: true, force: true }))
      }),
    { git: true },
    30000,
  )
}

it.instance(
  "Task deleted worktree is reconstructed from its settled snapshot for both task_id continuation and resume_from",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const llm = yield* TestLLMServer
      const directory = yield* Effect.promise(() => realpath(instance.directory))
      yield* Effect.promise(() => Bun.write(path.join(directory, "tracked.txt"), "COMMITTED"))
      for (const args of [
        ["init"],
        ["add", "tracked.txt"],
        ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "base"],
      ]) {
        const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd: directory })
        expect(result.exitCode).toBe(0)
      }
      yield* configure(directory, llm.url)
      yield* Effect.promise(() => Bun.write(path.join(directory, "tracked.txt"), "DIRTY_PARENT"))
      yield* Effect.promise(() => Bun.write(path.join(directory, "untracked.txt"), "UNTRACKED_PARENT"))
      const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(
        yield* (yield* post("/api/session", {
          commandSandbox: "workspace",
          location: { directory },
          model: { providerID: "task-fixture", id: "model" },
          agent: "build",
        })).json,
      )).data
      const requests: string[] = []
      yield* llm.respond(() =>
        reply()
          .tool("task", {
            description: "Recoverable source",
            prompt: "RECOVER_SOURCE",
            subagent_type: "helper",
            isolation: "worktree",
          })
          .item(),
      )
      yield* llm.respond(() =>
        reply()
          .tool("bash", {
            command:
              "pwd; cat tracked.txt untracked.txt; printf CHILD_TRACKED > tracked.txt; printf CHILD_EDIT > child.txt",
            description: "Write settled worktree state",
          })
          .item(),
      )
      yield* llm.respond((hit) => {
        requests.push(JSON.stringify(hit.body.messages))
        return reply().text("RECOVER_SOURCE_DONE").stop().item()
      })
      yield* llm.respond(() => reply().text("PARENT_RECOVER_SOURCE_DONE").stop().item())
      expect((yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Create worktree" } })).status).toBe(
        200,
      )
      yield* pollWithTimeout(
        history(parent.id).pipe(
          Effect.map((items) =>
            items.some(
              (item) =>
                item.type === "assistant" &&
                item.content.some((part) => part.type === "text" && part.text === "PARENT_RECOVER_SOURCE_DONE"),
            )
              ? true
              : undefined,
          ),
        ),
        "Source task did not settle",
        "20 seconds",
      )
      const first = yield* HttpClient.get(`/api/session/${parent.id}/task`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Task.Summary))),
      )
      expect(first).toHaveLength(1)
      expect(first[0].status).toBe("completed")
      const sourceID = first[0].id
      const sourceDetail = yield* HttpClient.get(`/api/session/${parent.id}/task/${sourceID}`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Task.Detail)),
      )
      const worktree = sourceDetail.worktreePath!
      expect(worktree).toBeDefined()
      expect(worktree).not.toBe(directory)
      yield* Effect.promise(() => rm(worktree, { recursive: true, force: true }))
      expect(yield* Effect.promise(() => Bun.file(path.join(worktree, "child.txt")).exists())).toBe(false)
      yield* Effect.promise(() => Bun.write(path.join(directory, "tracked.txt"), "MUTATED_PARENT"))
      yield* Effect.promise(() => Bun.write(path.join(directory, "untracked.txt"), "MUTATED_UNTRACKED"))
      yield* Effect.promise(() => Bun.write(path.join(directory, "parent-only.txt"), "MUST_NOT_LEAK"))
      yield* llm.respond(() =>
        reply()
          .tool("task", {
            description: "Continue deleted worktree",
            prompt: "RECOVER_FOLLOWUP",
            subagent_type: "helper",
            task_id: sourceID,
          })
          .item(),
      )
      yield* llm.respond(() =>
        reply()
          .tool("bash", {
            command:
              "pwd; cat tracked.txt untracked.txt child.txt; test ! -e parent-only.txt && echo NO_PARENT_LEAK; printf FOLLOWUP_EDIT > followup.txt",
            description: "Inspect reconstructed worktree on task_id continuation",
          })
          .item(),
      )
      yield* llm.respond((hit) => {
        requests.push(JSON.stringify(hit.body.messages))
        return reply().text("RECOVER_FOLLOWUP_DONE").stop().item()
      })
      yield* llm.respond(() => reply().text("PARENT_FOLLOWUP_DONE").stop().item())
      expect(
        (yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Continue deleted worktree" } })).status,
      ).toBe(200)
      yield* pollWithTimeout(
        history(parent.id).pipe(
          Effect.map((items) =>
            items.some(
              (item) =>
                item.type === "assistant" &&
                item.content.some((part) => part.type === "text" && part.text === "PARENT_FOLLOWUP_DONE"),
            )
              ? true
              : undefined,
          ),
        ),
        "Follow-up task did not settle",
        "20 seconds",
      )
      expect(requests[1]).toContain(worktree)
      expect(requests[1]).toContain("CHILD_TRACKED")
      expect(requests[1]).toContain("UNTRACKED_PARENT")
      expect(requests[1]).toContain("CHILD_EDIT")
      expect(requests[1]).toContain("NO_PARENT_LEAK")
      expect(requests[1]).not.toContain("MUTATED_PARENT")
      expect(requests[1]).not.toContain("MUTATED_UNTRACKED")
      expect(yield* llm.calls).toBe(8)
      yield* Effect.promise(() => rm(worktree, { recursive: true, force: true }))
      expect(yield* Effect.promise(() => Bun.file(path.join(worktree, "followup.txt")).exists())).toBe(false)
      yield* llm.respond(() =>
        reply()
          .tool("task", {
            description: "Resume deleted worktree",
            prompt: "RECOVER_RESUME_FROM",
            subagent_type: "other",
            resume_from: sourceID,
          })
          .item(),
      )
      yield* llm.respond(() =>
        reply()
          .tool("bash", {
            command:
              "pwd; cat tracked.txt untracked.txt child.txt followup.txt; test ! -e parent-only.txt && echo NO_PARENT_LEAK_RESUME",
            description: "Inspect reconstructed worktree on resume_from",
          })
          .item(),
      )
      yield* llm.respond((hit) => {
        requests.push(JSON.stringify(hit.body.messages))
        return reply().text("RECOVER_RESUME_DONE").stop().item()
      })
      yield* llm.respond(() => reply().text("PARENT_RECOVER_RESUME_DONE").stop().item())
      expect(
        (yield* post(`/api/session/${parent.id}/prompt`, { prompt: { text: "Resume deleted worktree" } })).status,
      ).toBe(200)
      yield* pollWithTimeout(
        history(parent.id).pipe(
          Effect.map((items) =>
            items.some(
              (item) =>
                item.type === "assistant" &&
                item.content.some((part) => part.type === "text" && part.text === "PARENT_RECOVER_RESUME_DONE"),
            )
              ? true
              : undefined,
          ),
        ),
        "Resumed task did not settle",
        "20 seconds",
      )
      expect(requests[2]).toContain(worktree)
      expect(requests[2]).toContain("CHILD_TRACKED")
      expect(requests[2]).toContain("UNTRACKED_PARENT")
      expect(requests[2]).toContain("CHILD_EDIT")
      expect(requests[2]).toContain("FOLLOWUP_EDIT")
      expect(requests[2]).toContain("NO_PARENT_LEAK_RESUME")
      expect(requests[2]).not.toContain("MUTATED_PARENT")
      expect(yield* llm.calls).toBe(12)
      yield* Effect.promise(() => rm(worktree, { recursive: true, force: true }))
    }),
  { git: true },
  30000,
)

it.instance(
  "Workflow worktree preserves dirty context and resumes its retained native placement",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const directory = yield* Effect.promise(() => realpath(instance.directory))
      const llm = yield* TestLLMServer
      yield* configure(directory, llm.url)
      yield* Effect.promise(() => Bun.write(path.join(directory, "fact.txt"), "WORKFLOW_DIRTY_FACT"))
      const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(
        yield* (yield* post("/api/session", {
          commandSandbox: "workspace",
          location: { directory },
          model: { providerID: "task-fixture", id: "model" },
          agent: "build",
        })).json,
      )).data
      const requests: string[] = []
      yield* llm.respond(() =>
        reply()
          .tool("bash", {
            command: "pwd; cat fact.txt; printf WORKFLOW_EDIT > child.txt",
            description: "Inspect Workflow worktree",
          })
          .item(),
      )
      yield* llm.respond((hit) => {
        requests.push(JSON.stringify(hit.body.messages))
        return reply().text("SOURCE_COMPLETE").stop().item()
      })
      yield* llm.respond(() =>
        reply().tool("bash", { command: "pwd; cat child.txt", description: "Inspect resumed worktree" }).item(),
      )
      yield* llm.respond((hit) => {
        requests.push(JSON.stringify(hit.body.messages))
        return reply().text("RESUME_COMPLETE").stop().item()
      })
      const root = `/api/session/${parent.id}/workflow`
      const run = yield* Schema.decodeUnknownEffect(Workflow.Info)(
        yield* (yield* post(root, {
          source: {
            type: "script",
            name: "placed",
            script:
              'let first=agent("WORKFLOW_PLACED_SOURCE",#{agent_type:"helper",isolation_worktree:true}); let second=agent("WORKFLOW_PLACED_NEXT",#{resume_from:first.agent_id}); complete(second);',
          },
        })).json,
      )
      const done = yield* pollWithTimeout(
        HttpClient.get(`${root}/${run.id}`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Workflow.Info)),
          Effect.map((info) => (["pending", "running"].includes(info.status) ? undefined : info)),
        ),
        "Workflow placement did not settle",
        "20 seconds",
      )
      expect(done.status).toBe("completed")
      expect(done.children).toHaveLength(2)
      const children = yield* Effect.forEach(done.children, (id) =>
        HttpClient.get(`/api/session/${id}`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({ data: Schema.Struct({ location: Schema.Struct({ directory: Schema.String }) }) }),
            ),
          ),
          Effect.map((result) => result.data),
        ),
      )
      expect(children[0].location.directory).not.toBe(directory)
      expect(children[1].location.directory).toBe(children[0].location.directory)
      expect(requests[0]).toContain("WORKFLOW_DIRTY_FACT")
      expect(requests[1]).toContain("WORKFLOW_EDIT")
      expect(yield* Effect.promise(() => Bun.file(path.join(directory, "child.txt")).exists())).toBe(false)
      expect(yield* llm.calls).toBe(4)
      yield* Effect.promise(() => rm(children[0].location.directory, { recursive: true, force: true }))
    }),
  { git: true },
  30000,
)

it.instance(
  "Workflow deleted worktree is reconstructed from its settled snapshot on resume_from without leaking mutated parent state",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const directory = yield* Effect.promise(() => realpath(instance.directory))
      const llm = yield* TestLLMServer
      yield* configure(directory, llm.url)
      yield* Effect.promise(() => Bun.write(path.join(directory, "fact.txt"), "WORKFLOW_DIRTY_FACT"))
      const parent = (yield* Schema.decodeUnknownEffect(SessionResponse)(
        yield* (yield* post("/api/session", {
          commandSandbox: "workspace",
          location: { directory },
          model: { providerID: "task-fixture", id: "model" },
          agent: "build",
        })).json,
      )).data
      const requests: string[] = []
      yield* llm.respond(() =>
        reply()
          .tool("bash", {
            command: "pwd; cat fact.txt; printf WORKFLOW_EDIT > child.txt",
            description: "Write settled Workflow worktree state",
          })
          .item(),
      )
      yield* llm.respond((hit) => {
        requests.push(JSON.stringify(hit.body.messages))
        return reply().text("WORKFLOW_SOURCE_COMPLETE").stop().item()
      })
      const root = `/api/session/${parent.id}/workflow`
      const firstRun = yield* Schema.decodeUnknownEffect(Workflow.Info)(
        yield* (yield* post(root, {
          source: {
            type: "script",
            name: "placed-source",
            script: 'let first=agent("WORKFLOW_PLACED_SOURCE",#{agent_type:"helper",isolation_worktree:true}); complete(first);',
          },
        })).json,
      )
      const firstDone = yield* pollWithTimeout(
        HttpClient.get(`${root}/${firstRun.id}`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Workflow.Info)),
          Effect.map((info) => (["pending", "running"].includes(info.status) ? undefined : info)),
        ),
        "First workflow placement did not settle",
        "20 seconds",
      )
      expect(firstDone.status).toBe("completed")
      expect(firstDone.children).toHaveLength(1)
      const sourceID = firstDone.children[0]
      const sourceSession = yield* HttpClient.get(`/api/session/${sourceID}`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Struct({ data: Schema.Struct({ location: Schema.Struct({ directory: Schema.String }) }) }),
          ),
        ),
      )
      const worktree = sourceSession.data.location.directory
      expect(worktree).not.toBe(directory)
      yield* Effect.promise(() => rm(worktree, { recursive: true, force: true }))
      expect(yield* Effect.promise(() => Bun.file(path.join(worktree, "child.txt")).exists())).toBe(false)
      yield* Effect.promise(() => Bun.write(path.join(directory, "fact.txt"), "MUTATED_PARENT_FACT"))
      yield* Effect.promise(() => Bun.write(path.join(directory, "parent-only.txt"), "NO_WORKFLOW_LEAK"))
      yield* llm.respond(() =>
        reply()
          .tool("bash", {
            command: "pwd; cat fact.txt child.txt; test ! -e parent-only.txt && echo NO_WORKFLOW_PARENT_LEAK",
            description: "Inspect reconstructed Workflow worktree",
          })
          .item(),
      )
      yield* llm.respond((hit) => {
        requests.push(JSON.stringify(hit.body.messages))
        return reply().text("WORKFLOW_RECOVERED_COMPLETE").stop().item()
      })
      const secondRun = yield* Schema.decodeUnknownEffect(Workflow.Info)(
        yield* (yield* post(root, {
          source: {
            type: "script",
            name: "placed-recover",
            script: `let second=agent("WORKFLOW_PLACED_NEXT",#{resume_from:"${sourceID}"}); complete(second);`,
          },
        })).json,
      )
      const secondDone = yield* pollWithTimeout(
        HttpClient.get(`${root}/${secondRun.id}`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Workflow.Info)),
          Effect.map((info) => (["pending", "running"].includes(info.status) ? undefined : info)),
        ),
        "Recovered workflow placement did not settle",
        "20 seconds",
      )
      expect(secondDone.status).toBe("completed")
      expect(secondDone.children).toHaveLength(1)
      const resumedSession = yield* HttpClient.get(`/api/session/${secondDone.children[0]}`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Struct({ data: Schema.Struct({ location: Schema.Struct({ directory: Schema.String }) }) }),
          ),
        ),
      )
      expect(resumedSession.data.location.directory).toBe(worktree)
      expect(requests[1]).toContain(worktree)
      expect(requests[1]).toContain("WORKFLOW_DIRTY_FACT")
      expect(requests[1]).toContain("WORKFLOW_EDIT")
      expect(requests[1]).toContain("NO_WORKFLOW_PARENT_LEAK")
      expect(requests[1]).not.toContain("MUTATED_PARENT_FACT")
      expect(yield* llm.calls).toBe(4)
      yield* Effect.promise(() => rm(worktree, { recursive: true, force: true }))
    }),
  { git: true },
  30000,
)

