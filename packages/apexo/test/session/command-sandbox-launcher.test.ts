import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { AppProcess } from "@apexo/core/process"
import { Seatbelt } from "@apexo/core/command-sandbox/seatbelt"

test.skipIf(process.platform !== "darwin")(
  "trusted launcher confirms actual confined command with opaque arguments and clean environment",
  async () => {
    const root = await mkdtemp(path.join(homedir(), ".apexo-launcher-"))
    const workspace = path.join(root, 'work quote";$(touch INJECTED) 字')
    const temporary = path.join(root, "tmp")
    await Promise.all([mkdir(workspace), mkdir(temporary)])
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const process = yield* AppProcess.Service
          const prepared = Seatbelt.prepare({
            workspace,
            temporary,
            home: root,
            cwd: workspace,
            profile: "workspace",
            protected: [],
            ancestors: [root, workspace],
            shell: "/bin/sh",
            command: 'printf "%s\\n" "$HOME" "$TMPDIR"; printf WORK > allowed; printf BAD > ../outside; env; exit 7',
          })
          const result = yield* process.run(prepared.command, { maxOutputBytes: 4096, maxErrorBytes: 4096 })
          const confirmed = prepared.confirm(result)
          expect(confirmed).toBeDefined()
          expect(confirmed!.exitCode).toBe(7)
          expect(confirmed!.stdout.toString()).toContain(workspace)
          expect(confirmed!.stdout.toString()).not.toContain("APEXO_COMMAND_SANDBOX_")
          expect(confirmed!.stderr.toString()).toContain("Operation not permitted")
          return confirmed!
        }).pipe(Effect.provide(LayerNode.compile(AppProcess.node))),
      )
      expect(await readFile(path.join(workspace, "allowed"), "utf8")).toBe("WORK")
      expect(await Bun.file(path.join(root, "outside")).exists()).toBe(false)
      expect(await Bun.file(path.join(workspace, "INJECTED")).exists()).toBe(false)
      expect(
        result.stdout
          .toString()
          .split("\n")
          .filter((line) => line.includes("="))
          .map((line) => line.split("=")[0])
          .sort(),
      ).toEqual(["HOME", "LANG", "PATH", "PWD", "SHLVL", "TMPDIR", "_"].sort())
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test.skipIf(process.platform !== "darwin")(
  "read-only denies workspace writes and failed wrapper never confirms or executes user command",
  async () => {
    const root = await mkdtemp(path.join(homedir(), ".apexo-launcher-"))
    const temporary = path.join(root, "tmp")
    await mkdir(temporary)
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const process = yield* AppProcess.Service
          const prepared = Seatbelt.prepare({
            workspace: root,
            temporary,
            home: root,
            cwd: root,
            profile: "read-only",
            protected: [],
            ancestors: [root],
            shell: "/bin/sh",
            command: 'printf BAD > blocked; printf OK > "$TMPDIR/allowed"',
          })
          const result = yield* process.run(prepared.command, { maxOutputBytes: 4096, maxErrorBytes: 4096 })
          expect(prepared.confirm(result)).toBeDefined()
          expect(result.stderr.toString()).toContain("Operation not permitted")
          const failed = yield* process.run(
            ChildProcess.make(
              prepared.command.command,
              prepared.command.args.map((arg, index) => (index === 1 ? "(invalid-profile)" : arg)),
              prepared.command.options,
            ),
            { maxOutputBytes: 4096, maxErrorBytes: 4096 },
          )
          expect(failed.exitCode).not.toBe(0)
          expect(prepared.confirm(failed)).toBeUndefined()
          expect(failed.stdout.length).toBe(0)
        }).pipe(Effect.provide(LayerNode.compile(AppProcess.node))),
      )
      expect(await Bun.file(path.join(root, "blocked")).exists()).toBe(false)
      expect(await readFile(path.join(temporary, "allowed"), "utf8")).toBe("OK")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test.skipIf(process.platform !== "darwin")(
  "AppProcess cancellation joins the confined process group including its child",
  async () => {
    const root = await mkdtemp(path.join(homedir(), ".apexo-launcher-"))
    const temporary = path.join(root, "tmp")
    await mkdir(temporary)
    const { Fiber } = await import("effect")
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const processService = yield* AppProcess.Service
          const prepared = Seatbelt.prepare({
            workspace: root,
            temporary,
            home: temporary,
            cwd: root,
            profile: "workspace",
            protected: [],
            ancestors: [root],
            shell: "/bin/sh",
            command: "echo $$ > parent.pid; /bin/sleep 30 & echo $! > child.pid; wait",
          })
          const running = yield* processService
            .run(prepared.command, { maxOutputBytes: 4096, maxErrorBytes: 4096 })
            .pipe(Effect.forkScoped)
          const pids = yield* Effect.promise(async () => {
            const deadline = Date.now() + 3000
            while (Date.now() < deadline) {
              const parent = await Bun.file(path.join(root, "parent.pid"))
                .text()
                .catch(() => "")
              const child = await Bun.file(path.join(root, "child.pid"))
                .text()
                .catch(() => "")
              if (parent.trim() && child.trim()) return [Number(parent), Number(child)]
              await Bun.sleep(5)
            }
            throw new Error("Confined child did not start")
          })
          yield* Fiber.interrupt(running)
          for (const pid of pids) {
            const gone = yield* Effect.promise(async () => {
              const deadline = Date.now() + 3000
              while (Date.now() < deadline) {
                const alive = (() => {
                  try {
                    process.kill(pid, 0)
                    return true
                  } catch {
                    return false
                  }
                })()
                if (!alive) return true
                await Bun.sleep(10)
              }
              return false
            })
            expect(gone).toBe(true)
          }
        }).pipe(Effect.scoped, Effect.provide(LayerNode.compile(AppProcess.node))),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  10000,
)
