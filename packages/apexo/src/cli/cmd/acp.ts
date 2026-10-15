import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ServerAuth } from "@/server/auth"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { ACPProfile } from "@/acp/profile"
import { Process } from "@/util/process"
import { pipeline } from "node:stream/promises"

export const AcpCommand = effectCmd({
  command: "acp",
  describe: "start an ACP server",
  builder: (yargs) => {
    return withNetworkOptions(yargs)
      .option("backend", {
        describe: "ACP backend",
        type: "string",
        choices: ["apexo", "grok-build"] as const,
        default: "apexo" as const,
      })
      .option("cwd", {
        describe: "working directory",
        type: "string",
        default: process.cwd(),
      })
  },
  handler: Effect.fn("Cli.acp")(function* (args) {
    if (args.backend === "grok-build") {
      yield* Effect.promise((signal) => runGrokBuildAgent(args.cwd, signal))
      return
    }

    const { Server } = yield* Effect.promise(() => import("@/server/server"))
    const { ACP } = yield* Effect.promise(() => import("@/acp/agent"))
    ACPProfile.mark("cli.acp.handler")
    process.env.APEXO_CLIENT = "acp"
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => ACPProfile.measure("cli.acp.server.listen", () => Server.listen(opts)))

    const sdk = createApexoClient({
      baseUrl: `http://${server.hostname}:${server.port}`,
      headers: ServerAuth.headers(),
    })

    const input = new WritableStream<Uint8Array>({
      write(chunk) {
        return new Promise<void>((resolve, reject) => {
          process.stdout.write(chunk, (err) => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          })
        })
      },
    })
    const output = new ReadableStream<Uint8Array>({
      start(controller) {
        process.stdin.on("data", (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk))
        })
        process.stdin.on("end", () => controller.close())
        process.stdin.on("error", (err) => controller.error(err))
      },
    })

    const stream = ndJsonStream(input, output)
    const agent = ACP.init({ sdk })

    new AgentSideConnection((conn) => {
      ACPProfile.mark("cli.acp.connection.create")
      return agent.create(conn)
    }, stream)

    yield* Effect.logInfo("setup connection")
    process.stdin.resume()
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve, reject) => {
          process.stdin.on("end", () => resolve())
          process.stdin.on("error", reject)
        }),
    )
  }),
})

/**
 * The official Grok Build agent already speaks ACP over stdio. Keep this
 * path as a transparent process boundary so the existing Apexo ACP server
 * remains the default while clients can opt into the official runtime.
 */
async function runGrokBuildAgent(cwd: string, signal: AbortSignal) {
  const command = process.env.APEXO_GROK_BUILD_BIN ?? "grok"
  const stop = new AbortController()
  const interrupt = () => stop.abort()
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  const abort = AbortSignal.any([signal, stop.signal])
  const agent = Process.spawn([command, "agent", "stdio"], {
    cwd,
    stdin: process.stdin,
    // Bun's own output descriptors can be nonblocking. Inheriting them makes
    // a native agent's large write fail with EAGAIN, corrupting NDJSON frames.
    stdout: "pipe",
    stderr: "pipe",
    abort,
  })
  const code = await Promise.all([
    agent.exited,
    pipeline(agent.stdout!, process.stdout, { end: false }),
    pipeline(agent.stderr!, process.stderr, { end: false }),
  ])
    .then(([code]) => code)
    .catch((error) => {
      stop.abort()
      throw error
    })
    .finally(() => {
      process.removeListener("SIGINT", interrupt)
      process.removeListener("SIGTERM", interrupt)
    })
  if (code !== 0 && !abort.aborted) throw new Error(`Grok Build ACP exited with code ${code}`)
}
