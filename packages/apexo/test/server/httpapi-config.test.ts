import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import { Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"

function app() {
  return Server.Default().app
}

function waitDisposed(directory: string) {
  return waitGlobalBusEvent({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
  })
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  it.live(
    "serves config update through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped({ startImmediately: true }))

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-apexo-directory": tmp.path,
            },
            body: JSON.stringify({
              username: "patched-user",
              formatter: false,
              lsp: false,
              memory: { session: { save_on_end: false } },
            }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "apexo.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      const reloaded = yield* Effect.promise(() =>
        Promise.resolve(app().request("/config", { headers: { "x-apexo-directory": tmp.path } })),
      )
      expect(reloaded.status).toBe(200)
      expect(yield* Effect.promise(() => reloaded.json())).toMatchObject({
        username: "patched-user",
        memory: { session: { save_on_end: false } },
      })
    }),
  )

  it.live(
    "updates the highest priority JSONC config without losing comments or other settings",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { username: "lower-priority", formatter: false, lsp: false } })
      const file = Bun.file(path.join(tmp.path, "apexo.jsonc"))
      yield* Effect.promise(() =>
        Bun.write(
          file,
          '{\n  // Keep this project note\n  "username": "original",\n  "memory": { "enabled": true, "session": { "save_on_end": true } }\n}\n',
        ),
      )
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped({ startImmediately: true }))
      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: { "content-type": "application/json", "x-apexo-directory": tmp.path },
            body: JSON.stringify({ username: "updated", memory: { session: { save_on_end: false } } }),
          }),
        ),
      )
      expect(response.status).toBe(200)
      yield* Effect.promise(() => response.json())
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => file.text())).toContain("// Keep this project note")
      const reloaded = yield* Effect.promise(() =>
        Promise.resolve(app().request("/config", { headers: { "x-apexo-directory": tmp.path } })),
      )
      expect(yield* Effect.promise(() => reloaded.json())).toMatchObject({
        username: "updated",
        memory: { enabled: true, session: { save_on_end: false } },
        formatter: false,
      })
    }),
  )

  it.live(
    "serves config with active provider model status",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            omniroute: {
              models: {
                "gpt-4o": {
                  status: "active",
                },
              },
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-apexo-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        provider: {
          omniroute: {
            models: {
              "gpt-4o": {
                status: "active",
              },
            },
          },
        },
      })
    }),
  )
})
