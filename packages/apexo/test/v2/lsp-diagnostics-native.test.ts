import { expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { EventV2 } from "@apexo/core/event"
import { LSP } from "@apexo/core/lsp"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { AgentV2 } from "@apexo/core/agent"
import { SessionV2 } from "@apexo/core/session"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const fixture = path.join(import.meta.dir, "../fixture/lsp-native-stdio.ts")
const app = (root: string) =>
  AppNodeBuilder.build(LayerNode.group([SessionV2.node, LocationServiceMap.node, EventV2.node]), [
    [
      Global.node,
      Layer.succeed(Global.Service)(
        Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
      ),
    ],
    [SessionExecution.node, SessionExecution.noopLayer],
  ])
const trace = (file: string) =>
  Effect.promise(async () =>
    (
      await Bun.file(file)
        .text()
        .catch(() => "")
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line): { event: string; uri?: string } => JSON.parse(line)),
  )

for (const mode of ["versioned", "unversioned"] as const)
  it.live(
    `native edit, write and apply_patch append Grok Build LSP diagnostics (${mode} publishes)`,
    () =>
      Effect.gen(function* () {
        const root = yield* tmpdirScoped()
        const directory = path.join(root, "project")
        const log = path.join(root, "trace")
        yield* Effect.promise(async () => {
          await Bun.write(
            path.join(directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              lsp: {
                local: {
                  command: [process.execPath, fixture],
                  extensions: [".fixture"],
                  env: { LSP_NATIVE_TRACE: log, LSP_NATIVE_DIAGNOSTICS: mode === "versioned" ? "1" : "unversioned" },
                },
              },
            }),
          )
          await Bun.write(path.join(directory, "main.fixture"), "fine\n")
          await Bun.write(path.join(directory, "gone.fixture"), "LSP_WARN old\n")
          await Bun.write(path.join(directory, "plain.txt"), "LSP_ERROR not a fixture\n")
        })
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const locations = yield* LocationServiceMap.Service
          const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
          yield* Effect.gen(function* () {
            const lsp = yield* LSP.Service
            expect((yield* lsp.status)[0]?.status).toBe("connected")
            const registry = yield* (yield* ToolRegistry.Service).materialize()
            const call = (name: string, input: unknown) =>
              registry
                .settle({
                  sessionID: session.id,
                  agent: AgentV2.ID.make("build"),
                  assistantMessageID: SessionMessage.ID.create(),
                  call: { type: "tool-call" as const, id: crypto.randomUUID(), name, input },
                })
                .pipe(
                  Effect.map((settled) => {
                    if (settled.result.type !== "text")
                      throw new Error(`${name} failed: ${JSON.stringify(settled.result)}`)
                    return settled.result.value
                  }),
                )
            const file = (name: string) => path.join(directory, name)
            const block = (...lines: string[]) =>
              `\n\n<system-reminder>\n<lsp-diagnostics>\n${lines.join("\n")}\n</lsp-diagnostics>\n</system-reminder>`

            // Clean edit: the server answers with no problems, so nothing is appended.
            const clean = yield* call("edit", { path: "main.fixture", oldString: "fine", newString: "still fine" })
            expect(clean).not.toContain("<lsp-diagnostics>")

            // Edit introducing problems: errors before warnings, information dropped.
            const broken = yield* call("edit", {
              path: "main.fixture",
              oldString: "still fine\n",
              newString: "LSP_INFO note\nLSP_WARN careful\nLSP_ERROR broken\n",
            })
            expect(broken).toEndWith(
              block(
                `${file("main.fixture")}:`,
                "  error[L3]: lsp_error on LSP_ERROR broken",
                "  warn[L2]: lsp_warn on LSP_WARN careful",
              ),
            )

            // Write creates a file and reports on it.
            const written = yield* call("write", { path: "new.fixture", content: "LSP_ERROR fresh\n" })
            expect(written).toStartWith("Created file successfully")
            expect(written).toEndWith(block(`${file("new.fixture")}:`, "  error[L1]: lsp_error on LSP_ERROR fresh"))

            // Files no server owns are never sent.
            const plain = yield* call("write", { path: "plain.txt", content: "LSP_ERROR still plain\n" })
            expect(plain).not.toContain("<lsp-diagnostics>")

            // A server that stays silent costs at most the 500ms drain budget.
            const started = Date.now()
            const silent = yield* call("write", { path: "main.fixture", content: "LSP_SILENT LSP_ERROR hidden\n" })
            expect(silent).not.toContain("<lsp-diagnostics>")
            expect(Date.now() - started).toBeLessThan(3_000)

            // apply_patch reports updated files and closes deleted ones it had opened.
            yield* call("write", { path: "gone.fixture", content: "LSP_WARN old\n" })
            const patched = yield* call("apply_patch", {
              patchText: [
                "*** Begin Patch",
                "*** Update File: main.fixture",
                "@@",
                "-LSP_SILENT LSP_ERROR hidden",
                "+repaired",
                "*** Delete File: gone.fixture",
                "*** Add File: added.fixture",
                "+LSP_WARN added",
                "*** End Patch",
              ].join("\n"),
            })
            expect(patched).toStartWith("Applied patch sequentially:")
            expect(patched).toEndWith(block(`${file("added.fixture")}:`, "  warn[L1]: lsp_warn on LSP_WARN added"))
            const events = yield* trace(log)
            expect(events.filter((entry) => entry.event === "close").map((entry) => entry.uri)).toEqual([
              Bun.pathToFileURL(file("gone.fixture")).href,
            ])
            expect(events.some((entry) => entry.uri?.endsWith("plain.txt"))).toBe(false)
          }).pipe(Effect.provide(locations.get(session.location)))
        }).pipe(Effect.provide(app(root)))
      }),
    { timeout: 30000 },
  )
