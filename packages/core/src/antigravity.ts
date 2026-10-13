export * as Antigravity from "./antigravity"

import os from "node:os"
import path from "node:path"
import { Cache, Context, Duration, Effect, Exit, Layer, Option, Schema, Semaphore } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { AppProcess } from "./process"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { windowsCredential } from "./antigravity-keyring"
import { makeGlobalNode } from "./effect/app-node"
import { httpClient } from "./effect/app-node-platform"

export const providerID = "antigravity"
export const methodID = "agy"
export const endpoint = "https://daily-cloudcode-pa.googleapis.com"

export class Error extends Schema.TaggedErrorClass<Error>()("Antigravity.Error", {
  message: Schema.String,
  loginRequired: Schema.optional(Schema.Boolean),
}) {}

const Token = Schema.Struct({
  token: Schema.Struct({
    access_token: Schema.NonEmptyString,
    refresh_token: Schema.optional(Schema.String),
    expiry: Schema.String,
  }),
  auth_method: Schema.optional(Schema.String),
})

/** go-keyring encodes binary-safe values on macOS; its shell output is not plain JSON. */
export function decodeCredential(value: string) {
  const text = value.trim()
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Token))(
    text.startsWith("go-keyring-base64:")
      ? Buffer.from(text.slice("go-keyring-base64:".length), "base64").toString("utf8")
      : text,
  )
  if (Option.isNone(decoded) || !Number.isFinite(Date.parse(decoded.value.token.expiry))) return
  return decoded.value
}

const Project = Schema.Struct({
  cloudaicompanionProject: Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]),
})

const Model = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  maxTokens: Schema.optional(Schema.Number),
  maxOutputTokens: Schema.optional(Schema.Number),
  supportsImages: Schema.optional(Schema.Boolean),
  supportsThinking: Schema.optional(Schema.Boolean),
  supportsVideo: Schema.optional(Schema.Boolean),
})
const Models = Schema.Struct({
  models: Schema.Record(Schema.String, Model),
  tieredModelIds: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  agentModelSorts: Schema.optional(
    Schema.Array(
      Schema.Struct({
        groups: Schema.Array(Schema.Struct({ modelIds: Schema.Array(Schema.String) })),
      }),
    ),
  ),
})

export function catalogModels(value: typeof Models.Type) {
  const ids = value.agentModelSorts?.flatMap((sort) => sort.groups.flatMap((group) => group.modelIds))
  return [
    ...new Set([...(ids ?? Object.keys(value.models)), ...Object.values(value.tieredModelIds ?? {}).flat()]),
  ].flatMap((id) => {
    const model = value.models[id]
    return model ? [{ id, ...model, name: model.displayName ?? id }] : []
  })
}

export const make = (input: {
  process: AppProcess.Interface
  fs: FSUtil.Interface
  http: HttpClient.HttpClient
  directory: string
  home: string
  keyring?: boolean
  platform: NodeJS.Platform
}) =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1)
    const run = (command: string, args: string[], timeout: Duration.Input = "15 seconds") =>
      input.process.run(ChildProcess.make(command, args), { timeout, maxOutputBytes: 1024 * 1024 }).pipe(
        Effect.mapError(
          () =>
            new Error({
              message:
                "Unable to read the native Antigravity session. Check that agy is installed and your keyring is unlocked.",
            }),
        ),
      )

    const command = Effect.gen(function* () {
      const executable =
        input.platform === "win32"
          ? path.join(input.home, "AppData", "Local", "agy", "bin", "agy.exe")
          : path.join(input.home, ".local", "bin", "agy")
      return (yield* input.fs.exists(executable)) ? executable : "agy"
    }).pipe(Effect.orDie)

    const read = Effect.fn("Antigravity.read")(
      function* () {
        const saved =
          input.keyring === false
            ? undefined
            : input.platform === "darwin"
              ? yield* run("security", ["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"])
              : input.platform === "linux"
                ? yield* run("secret-tool", ["lookup", "service", "gemini", "username", "antigravity"]).pipe(
                    Effect.catch(() => Effect.succeed(undefined)),
                  )
                : input.platform === "win32"
                  ? yield* run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsCredential])
                  : undefined
        if (saved?.exitCode === 0) {
          const value = decodeCredential(saved.stdout.toString("utf8"))
          if (!value)
            return yield* new Error({
              message: "The native Antigravity credential has an unsupported format. Sign in using agy again.",
            })
          return value
        }
        if (
          saved &&
          ((input.platform === "linux" && (saved.exitCode !== 1 || saved.stderr.length > 0)) ||
            ((input.platform === "darwin" || input.platform === "win32") && saved.exitCode !== 44))
        )
          return yield* new Error({
            message: "The Antigravity keyring entry could not be read. Unlock your keyring and retry.",
          })
        const file = path.join(input.directory, "antigravity-oauth-token")
        if (!(yield* input.fs.exists(file))) {
          if (input.platform === "linux" && input.keyring !== false && !saved)
            return yield* new Error({
              message: "Install secret-tool (libsecret tools) to reuse the native Antigravity keyring, then reconnect.",
            })
          return
        }
        const value = decodeCredential(yield* input.fs.readFileString(file))
        if (!value)
          return yield* new Error({ message: "The native Antigravity credential file has an unsupported format." })
        return value
      },
      Effect.mapError((error) =>
        error instanceof Error
          ? error
          : new Error({ message: "Unable to read the native Antigravity credential file." }),
      ),
    )

    const available = read().pipe(
      Effect.map((value) => !!value && (Date.parse(value.token.expiry) > Date.now() || !!value.token.refresh_token)),
    )

    const token = lock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* read()
        if (!current)
          return yield* new Error({ message: "Sign in with agy to connect Antigravity.", loginRequired: true })
        if (Date.parse(current.token.expiry) > Date.now() + 60_000) return current.token.access_token
        if (!current.token.refresh_token)
          return yield* new Error({
            message: "The Antigravity session has expired. Open agy to sign in again.",
            loginRequired: true,
          })
        // Let the credential owner refresh and persist its own token. Never create another OAuth session.
        const refreshed = yield* run(yield* command, ["models"], "45 seconds")
        if (refreshed.exitCode !== 0)
          return yield* new Error({
            message: "Antigravity could not refresh its session. Open agy to sign in again.",
            loginRequired: true,
          })
        const next = yield* read()
        if (!next || Date.parse(next.token.expiry) <= Date.now())
          return yield* new Error({
            message: "The Antigravity session has expired. Open agy to sign in again.",
            loginRequired: true,
          })
        return next.token.access_token
      }),
    )

    const post = <S extends Schema.Top>(name: string, body: unknown, schema: S, access: string) =>
      Effect.gen(function* () {
        const request = yield* HttpClientRequest.post(`${endpoint}/v1internal:${name}`).pipe(
          HttpClientRequest.setHeaders({ authorization: `Bearer ${access}`, "user-agent": "apexo-antigravity" }),
          HttpClientRequest.bodyJson(body),
        )
        const response = yield* input.http.execute(request)
        if (response.status !== 200)
          return yield* new Error({
            message: `Antigravity ${name} failed (HTTP ${response.status}).`,
            loginRequired: response.status === 401,
          })
        return yield* HttpClientResponse.schemaBodyJson(schema)(response)
      }).pipe(
        Effect.timeout("30 seconds"),
        Effect.mapError((error) =>
          error instanceof Error ? error : new Error({ message: `Unable to load Antigravity ${name}.` }),
        ),
      )

    const projects = yield* Cache.makeWith(
      (access: string) =>
        post("loadCodeAssist", { metadata: { ideType: "ANTIGRAVITY" } }, Project, access).pipe(
          Effect.map((result) =>
            typeof result.cloudaicompanionProject === "string"
              ? result.cloudaicompanionProject
              : result.cloudaicompanionProject.id,
          ),
        ),
      { capacity: 2, timeToLive: (exit) => (Exit.isSuccess(exit) ? "5 minutes" : 0) },
    )
    const session = Effect.gen(function* () {
      const access = yield* token
      return { access, projectID: yield* Cache.get(projects, access) }
    })

    const catalogs = yield* Cache.makeWith(
      (access: string) =>
        Effect.gen(function* () {
          const project = yield* Cache.get(projects, access)
          return catalogModels(yield* post("fetchAvailableModels", { project }, Models, access))
        }),
      { capacity: 2, timeToLive: (exit) => (Exit.isSuccess(exit) ? "5 minutes" : 0) },
    )
    const models = token.pipe(Effect.flatMap((access) => Cache.get(catalogs, access)))
    const connect = available.pipe(
      Effect.flatMap((present) => (present ? session.pipe(Effect.as(true)) : Effect.succeed(false))),
      Effect.catch((error) => (error.loginRequired ? Effect.succeed(false) : Effect.fail(error))),
    )

    return { available, connect, session, models, command }
  })

export class Service extends Context.Service<Service, Effect.Success<ReturnType<typeof make>>>()(
  "@apexo/Antigravity",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    const fs = yield* FSUtil.Service
    const http = yield* HttpClient.HttpClient
    const global = yield* Global.Service
    return yield* make({
      process: appProcess,
      fs,
      http,
      home: global.home,
      keyring: global.home === os.homedir(),
      directory: path.join(global.home, ".gemini", "antigravity-cli"),
      platform: process.platform,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [AppProcess.node, FSUtil.node, Global.node, httpClient],
})
