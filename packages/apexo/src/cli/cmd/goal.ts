import { cmd } from "./cmd"
import { CliError } from "../effect-cmd"
import { ServerAuth } from "@/server/auth"

export const GoalCommand = cmd({
  command: "goal <action> [objective..]",
  describe: "create and control a persistent goal on a running server",
  builder: (yargs) =>
    yargs
      .positional("action", {
        choices: [
          "create",
          "status",
          "start",
          "pause",
          "resume",
          "clear",
          "reports",
          "report",
          "cleanup-reports",
        ] as const,
        demandOption: true,
      })
      .positional("objective", { type: "string", array: true })
      .option("attach", { type: "string", demandOption: true, describe: "URL of the running apexo server" })
      .option("session", {
        type: "string",
        alias: "s",
        describe: "session ID; create makes a new session when omitted",
      })
      .option("id", { type: "string", describe: "goal ID for retrying creation or guarding a control operation" })
      .option("model", { type: "string", alias: "m", describe: "initial model in provider/model format" })
      .option("agent", { type: "string", default: "build" })
      .option("variant", { type: "string" })
      .option("budget", { type: "number", describe: "positive token budget; omitted means unlimited" })
      .option("report", { type: "string", describe: "report ID returned by goal reports" })
      .option("file", {
        choices: ["objective", "evidence", "plan", "verdict", "details", "changes", "changedFiles"] as const,
        describe: "report file to read",
      })
      .option("output", { type: "string", describe: "save report to a new local file; use - for plain text stdout" })
      .option("dir", { type: "string", describe: "project directory on the server" })
      .option("password", { type: "string", describe: "server password (defaults to APEXO_SERVER_PASSWORD)" })
      .option("username", { type: "string", describe: "server username (defaults to APEXO_SERVER_USERNAME)" }),
  async handler(args) {
    try {
      const { createApexoClient } = await import("@apexo/sdk/v2/client")
      const client = createApexoClient({
        baseUrl: args.attach,
        directory: args.dir,
        headers: ServerAuth.headers(args),
        throwOnError: true,
      })
      const options = { throwOnError: true as const }
      const selection = async () => {
        let modelSpec = args.model
        if (!modelSpec) {
          const cfg = await client.config
            .get(undefined, options)
            .then((r) => r.data)
            .catch(() => undefined)
          if (cfg?.model && cfg.model.includes("/")) {
            modelSpec = cfg.model
          } else {
            const prov = await client.config
              .providers(undefined, options)
              .then((r) => r.data)
              .catch(() => undefined)
            const firstProvider = prov?.providers?.[0]
            const defModel = firstProvider ? (prov?.default?.[firstProvider.id] ?? Object.keys(firstProvider.models ?? {})[0]) : undefined
            if (firstProvider && defModel) {
              modelSpec = `${firstProvider.id}/${defModel}`
            }
          }
        }
        const separator = modelSpec?.indexOf("/") ?? -1
        if (!modelSpec || separator < 1 || separator === modelSpec.length - 1)
          throw new CliError({ message: "Select the initial model with --model provider/model" })
        return {
          agent: args.agent,
          model: {
            providerID: modelSpec.slice(0, separator),
            id: modelSpec.slice(separator + 1),
            variant: args.variant,
          },
        }
      }
      if (args.action === "create") {
        const objective = args.objective?.join(" ").trim()
        if (!objective || objective.length > 32768)
          throw new CliError({ message: "Provide an objective of 1–32768 characters" })
        if (args.budget !== undefined && (!Number.isSafeInteger(args.budget) || args.budget < 1))
          throw new CliError({ message: "--budget must be a positive safe integer" })
        const selected = await selection()
        const id = args.id ?? `goal_${crypto.randomUUID().replaceAll("-", "")}`
        if (!/^goal_[a-zA-Z0-9]+$/.test(id)) throw new CliError({ message: "--id must be a Goal ID" })
        const sessionID =
          args.session ?? (await client.session.create({ title: objective.slice(0, 100) }, options)).data.id
        const created = (
          await client.goal.create({ sessionID, goalCreate: { id, objective, tokenBudget: args.budget } }, options)
        ).data
        console.log(
          JSON.stringify(
            (await client.goal.start({ sessionID, goalID: created.id, goalStart: selected }, options)).data,
            null,
            2,
          ),
        )
        return
      }
      if (!args.session) throw new CliError({ message: "Provide --session for this operation" })
      const current = (await client.goal.get({ sessionID: args.session }, options)).data
      if (args.action === "status") {
        console.log(JSON.stringify(current, null, 2))
        return
      }
      if (args.action === "reports" || args.action === "report" || args.action === "cleanup-reports") {
        const goalID = args.id ?? current?.id
        if (!goalID) throw new CliError({ message: "Provide --id for reports of a cleared goal" })
        const target = { sessionID: args.session, goalID }
        if (args.action === "reports") {
          console.log(JSON.stringify((await client.goal.reports(target, options)).data, null, 2))
          return
        }
        if (args.action === "cleanup-reports") {
          const result = (await client.goal.cleanupReports(target, options)).data
          console.log(JSON.stringify(result, null, 2))
          if (result.failed.length) process.exitCode = 1
          return
        }
        if (!args.report || !args.file) throw new CliError({ message: "Provide --report and --file" })
        const report = (await client.goal.report({ ...target, reportID: args.report, file: args.file }, options)).data
        if (args.output === "-") {
          process.stdout.write(report.text)
          return
        }
        if (args.output) {
          const { open } = await import("node:fs/promises")
          // Downloads must not silently overwrite existing local files.
          await using output = await open(args.output, "wx", 0o600)
          await output.writeFile(report.text, "utf8")
          console.log(JSON.stringify({ path: args.output, bytes: report.bytes, sha256: report.sha256 }, null, 2))
          return
        }
        console.log(JSON.stringify(report, null, 2))
        return
      }
      if (!current) throw new CliError({ message: "This session has no goal" })
      if (args.id && args.id !== current.id)
        throw new CliError({ message: "The goal was replaced; the supplied --id is stale" })
      const target = { sessionID: args.session, goalID: current.id }
      const result =
        args.action === "start"
          ? await client.goal.start({ ...target, goalStart: current.launch ?? (await selection()) }, options)
          : await client.goal[args.action](target, options)
      console.log(JSON.stringify(result.data, null, 2))
    } catch (error) {
      if (error instanceof CliError) throw error
      const msg =
        error && typeof error === "object" && "message" in error && typeof error.message === "string"
          ? error.message
          : error &&
              typeof error === "object" &&
              "data" in error &&
              error.data &&
              typeof error.data === "object" &&
              "message" in error.data &&
              typeof error.data.message === "string"
            ? error.data.message
            : String(error)
      throw new CliError({ message: msg })
    }
  },
})
