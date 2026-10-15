import path from "node:path"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { PluginStore } from "@apexo/core/plugin-store"
import { Global } from "@apexo/core/global"

const actions = [
  "refresh",
  "add-source",
  "remove-source",
  "install",
  "download",
  "update",
  "enable",
  "disable",
  "uninstall",
] as const

export const PluginsCommand = cmd({
  command: "plugins",
  describe: "browse, download and manage Plugins",
  builder: (yargs) =>
    yargs
      .command(
        effectCmd({
          command: "list",
          describe: "list available and installed plugins",
          instance: false,
          builder: (yargs) => yargs.option("json", { type: "boolean" }).option("installed", { type: "boolean" }),
          handler: Effect.fn("Cli.plugins.list")(function* (args) {
            const result = yield* Effect.tryPromise(() =>
              PluginStore.catalog(path.join(Global.Path.data, "plugins")),
            ).pipe(Effect.catch((error) => fail(String(error))))
            const items = result.items.filter((item) => !args.installed || item.status !== "available")
            if (args.json) {
              console.log(JSON.stringify({ ...result, items }, null, 2))
              return
            }
            for (const item of items) console.log(`${item.id}\t${item.status}\t${item.description}`)
            if (!result.items.length)
              console.log("Run apexo plugins refresh or apexo plugins add-source <source> to browse plugins.")
          }),
        }),
      )
      .command(
        effectCmd({
          command: "details <id>",
          describe: "show plugin contents and source",
          instance: false,
          builder: (yargs) => yargs.positional("id", { type: "string", demandOption: true }),
          handler: Effect.fn("Cli.plugins.details")(function* (args) {
            console.log(
              JSON.stringify(
                yield* Effect.tryPromise(() =>
                  PluginStore.detail(path.join(Global.Path.data, "plugins"), args.id),
                ).pipe(Effect.catch((error) => fail(String(error)))),
                null,
                2,
              ),
            )
          }),
        }),
      )
      .command(
        actions.map((action) =>
          effectCmd({
            command: `${action} [target]`,
            describe: `${action} plugins`,
            instance: false,
            builder: (yargs) => {
              const base = yargs
                .positional("target", { type: "string" })
                .option("trust", { type: "boolean", describe: "trust this plugin to execute code and access files" })
                .option("source", { type: "string", describe: "Git repository or local plugin directory" })
              return action === "uninstall"
                ? base.option("keep-data", {
                    type: "boolean",
                    describe: "retain persistent plugin data when uninstalling",
                  })
                : base
            },
            handler: Effect.fn(`Cli.plugins.${action}`)(function* (args) {
              const result = yield* Effect.tryPromise({
                try: () =>
                  PluginStore.mutate(path.join(Global.Path.data, "plugins"), {
                    action,
                    id: args.target,
                    source: action === "add-source" ? args.target : args.source,
                    trust: args.trust,
                    ...(args["keep-data"] === undefined ? {} : { keepData: args["keep-data"] }),
                  }),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              }).pipe(Effect.catch((error) => fail(error.message)))
              console.log(JSON.stringify(result, null, 2))
              if (result.retainedData?.length)
                console.error(
                  "Plugins: data cleanup is deferred; data is retained while in use or when ownership cannot be verified.",
                )
            }),
          }),
        ),
      )
      .demandCommand(),
  async handler() {},
})
