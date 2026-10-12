import { SessionsQuery } from "@apexo/protocol/groups/session"
import { Effect, Schema, Stream } from "effect"
import { createInterface } from "node:readline"
import { ServerAuth } from "../../server/auth"
import { CliError, effectCmd } from "../effect-cmd"

const Request = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.Literal("session.list"),
  query: Schema.optional(Schema.toType(SessionsQuery)),
})
export type JsonlRequest = Schema.Schema.Type<typeof Request>

export function parseJsonlRequest(line: string) {
  return Schema.decodeUnknownSync(Request)(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(line))
}

export function sessionListUrl(baseUrl: string, query: JsonlRequest["query"]) {
  const url = new URL("/api/session", baseUrl)
  for (const [key, value] of Object.entries(Schema.encodeSync(SessionsQuery)(query ?? {}))) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url
}

export const JsonlCommand = effectCmd({
  command: "jsonl",
  describe: "run a thin JSONL adapter for an existing Protocol/Client operation",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("url", {
        describe: "Apexo HTTP server URL",
        type: "string",
        default: process.env.APEXO_SERVER_URL ?? "http://127.0.0.1:4096",
      })
      .option("password", { type: "string", describe: "basic auth password (defaults to APEXO_SERVER_PASSWORD)" })
      .option("username", { type: "string", describe: "basic auth username (defaults to APEXO_SERVER_USERNAME)" }),
  handler: Effect.fn("Cli.jsonl")(function* (args) {
    yield* Effect.acquireUseRelease(
      Effect.sync(() => createInterface({ input: process.stdin, crlfDelay: Infinity })),
      (input) =>
        Stream.fromAsyncIterable(input, (error) => new CliError({ message: String(error) })).pipe(
          Stream.filter((line) => Boolean(line.trim())),
          Stream.runForEach((line) =>
            Effect.tryPromise({
              try: async () => {
                const request = parseJsonlRequest(line)
                const response = await fetch(sessionListUrl(args.url, request.query), {
                  headers: ServerAuth.headers(args),
                })
                if (!response.ok) throw new Error(`session.list failed: HTTP ${response.status}`)
                const result: unknown = await response.json()
                process.stdout.write(JSON.stringify({ id: request.id ?? null, method: request.method, result }) + "\n")
              },
              catch: (error) => new CliError({ message: String(error) }),
            }),
          ),
        ),
      (input) => Effect.sync(() => input.close()),
    )
  }),
})
