import { EOL } from "os"
import { Effect } from "effect"
import { Skill } from "../../../skill"
import { ServerAuth } from "../../../server/auth"
import { CliError, effectCmd } from "../../effect-cmd"

export const SkillCommand = effectCmd({
  command: "skill",
  describe: "list all available skills",
  builder: (yargs) =>
    yargs
      .option("reload", { type: "boolean", default: false, describe: "reload skill sources" })
      .option("attach", { type: "string", describe: "use an existing Apexo server" })
      .option("protocol", { choices: ["v1", "v2"] as const, default: "v1", describe: "attached server protocol" })
      .option("directory", { type: "string", default: process.cwd(), describe: "project directory on the server" })
      .option("password", { type: "string", describe: "basic auth password (defaults to APEXO_SERVER_PASSWORD)" })
      .option("username", { type: "string", describe: "basic auth username (defaults to APEXO_SERVER_USERNAME)" }),
  instance: (args) => !args.attach,
  directory: (args) => args.directory,
  handler: Effect.fn("Cli.debug.skill")(function* (args) {
    if (args.attach) {
      const { createApexoClient } = yield* Effect.promise(() => import("@apexo/sdk/v2/client"))
      const client = createApexoClient({
        baseUrl: args.attach,
        directory: args.directory,
        headers: ServerAuth.headers(args),
        throwOnError: true,
      })
      const skills = yield* Effect.tryPromise({
        try: async () => {
          if (args.protocol === "v2") {
            const location = { directory: args.directory }
            if (args.reload) await client.v2.skill.reload({ location })
            return (await client.v2.skill.list({ location })).data?.data
          }
          if (args.reload) await client.skill.reload({ directory: args.directory })
          return (await client.app.skills({ directory: args.directory })).data
        },
        catch: (error) => new CliError({ message: String(error) }),
      })
      process.stdout.write(JSON.stringify(skills, null, 2) + EOL)
      return
    }
    const skill = yield* Skill.Service
    if (args.reload) yield* skill.reload()
    const skills = yield* skill.all()
    process.stdout.write(JSON.stringify(skills, null, 2) + EOL)
  }),
})
