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

// Effect.tryPromise without `catch` hides the store's message behind "An error occurred in Effect.tryPromise".
const message = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

const grokSubcommands = new Set([
  "list",
  "details",
  "install",
  "update",
  "enable",
  "disable",
  "uninstall",
  "rm",
  "remove",
  "marketplace",
  "refresh",
  "download",
  "add-source",
  "remove-source",
  "sources",
  "validate",
  "tag",
])

/**
 * Grok Build spells plugin management `grok plugin <subcommand>`, while `apexo plugin <module>` is the
 * npm plugin installer. Without this translation `apexo plugin list` would silently add an npm package
 * named "list" to the project config. Rewrites Grok's spellings to the equivalent `apexo plugins` call.
 */
export function grokPluginArgs(args: string[]): string[] {
  const at = args.findIndex((arg) => !arg.startsWith("-"))
  if (at < 0 || !["plugin", "plug"].includes(args[at]!)) return args
  const sub = args[at + 1]
  if (!sub || !grokSubcommands.has(sub)) return args
  const before = args.slice(0, at)
  const rest = args.slice(at + 2)
  const drop = (list: string[], flag: string) => list.filter((arg) => arg !== flag)
  if (sub === "marketplace") {
    const [action, ...tail] = rest
    const mapped =
      action === "add"
        ? "add-source"
        : action === "remove" || action === "rm"
          ? "remove-source"
          : action === "update"
            ? "refresh"
            : action === "list" || action === undefined
              ? "sources"
              : action
    return [...before, "plugins", mapped, ...tail]
  }
  if (sub === "rm" || sub === "remove" || sub === "uninstall")
    return [...before, "plugins", "uninstall", ...drop(rest, "--confirm")]
  // Grok lists installed plugins by default; `--available` includes the catalog.
  if (sub === "list")
    return rest.includes("--available")
      ? [...before, "plugins", "list", ...drop(rest, "--available")]
      : [...before, "plugins", "list", "--installed", ...rest]
  return [...before, "plugins", sub, ...rest]
}

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
            const result = yield* Effect.tryPromise({
              try: () => PluginStore.catalog(path.join(Global.Path.data, "plugins")),
              catch: message,
            }).pipe(Effect.catch((error) => fail(error.message)))
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
          command: "sources",
          describe: "list plugin sources",
          instance: false,
          builder: (yargs) => yargs.option("json", { type: "boolean" }),
          handler: Effect.fn("Cli.plugins.sources")(function* (args) {
            const result = yield* Effect.tryPromise({
              try: () => PluginStore.catalog(path.join(Global.Path.data, "plugins")),
              catch: message,
            }).pipe(Effect.catch((error) => fail(error.message)))
            if (args.json) {
              console.log(JSON.stringify(result.sources, null, 2))
              return
            }
            for (const source of result.sources)
              console.log([source.id, source.name, source.location, source.error].filter(Boolean).join("\t"))
            if (!result.sources.length)
              console.log("No plugin sources. Add one with apexo plugins add-source <source>.")
          }),
        }),
      )
      .command(
        effectCmd({
          command: "validate [path]",
          describe: "check a plugin folder or marketplace repository before publishing",
          instance: false,
          builder: (yargs) =>
            yargs
              .positional("path", { type: "string", default: "." })
              .option("json", { type: "boolean", default: false, describe: "print the result as JSON" }),
          handler: Effect.fn("Cli.plugins.validate")(function* (args) {
            const result = yield* Effect.promise(() => PluginStore.validate(args.path ?? "."))
            if (args.json) console.log(JSON.stringify(result, null, 2))
            else {
              console.log(`${result.kind} ${result.name ?? ""} ${result.version ?? ""}`.trim() + `\t${result.path}`)
              for (const error of result.errors) console.log(`error\t${error}`)
              for (const warning of result.warnings) console.log(`warning\t${warning}`)
              for (const plugin of result.plugins) {
                for (const error of plugin.errors) console.log(`error\t${plugin.name}: ${error}`)
                for (const warning of plugin.warnings) console.log(`warning\t${plugin.name}: ${warning}`)
              }
            }
            const failed = result.errors.length + result.plugins.reduce((sum, item) => sum + item.errors.length, 0)
            if (failed) return yield* fail(`Validation failed with ${failed} error${failed === 1 ? "" : "s"}.`)
            if (!args.json) console.log("Valid.")
          }),
        }),
      )
      .command(
        effectCmd({
          command: "tag [path]",
          describe: "tag a release from the plugin manifest version",
          instance: false,
          builder: (yargs) =>
            yargs
              .positional("path", { type: "string", default: "." })
              .option("push", { type: "boolean", default: false, describe: "push the tag to origin" }),
          handler: Effect.fn("Cli.plugins.tag")(function* (args) {
            const result = yield* Effect.tryPromise({
              try: () => PluginStore.tag(args.path ?? ".", { push: args.push }),
              catch: message,
            }).pipe(Effect.catch((error) => fail(error.message)))
            console.log(`Tagged ${result.tag}${result.pushed ? " and pushed it to origin" : ""}.`)
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
                yield* Effect.tryPromise({
                  try: () => PluginStore.detail(path.join(Global.Path.data, "plugins"), args.id),
                  catch: message,
                }).pipe(Effect.catch((error) => fail(error.message))),
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
            ...(action === "uninstall" ? { aliases: ["rm", "remove"] } : {}),
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
