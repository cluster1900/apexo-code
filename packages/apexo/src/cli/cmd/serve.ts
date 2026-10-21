import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@apexo/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless apexo server",
  // Server loads instances per-request via x-apexo-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.APEXO_SERVER_PASSWORD) {
      console.log("Warning: APEXO_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`apexo server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.callback<void>((resume) => {
      const onSignal = () => {
        process.off("SIGTERM", onSignal)
        process.off("SIGINT", onSignal)
        resume(Effect.void)
      }
      process.on("SIGTERM", onSignal)
      process.on("SIGINT", onSignal)
      return Effect.sync(() => {
        process.off("SIGTERM", onSignal)
        process.off("SIGINT", onSignal)
      })
    }).pipe(Effect.ensuring(Effect.promise(() => server.stop(true))))
  }),
})
