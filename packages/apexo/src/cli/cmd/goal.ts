import { cmd } from "./cmd"
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
    const { createApexoClient } = await import("@apexo/sdk/v2/client")
    const client = createApexoClient({
      baseUrl: args.attach,
      directory: args.dir,
      headers: ServerAuth.headers(args),
      throwOnError: true,
    })
    const options = { throwOnError: true as const }
    const selection = () => {
      const separator = args.model?.indexOf("/") ?? -1
      if (!args.model || separator < 1 || separator === args.model.length - 1)
        throw new Error("Select the initial model with --model provider/model")
      return {
        agent: args.agent,
        model: {
          providerID: args.model.slice(0, separator),
          id: args.model.slice(separator + 1),
          variant: args.variant,
        },
      }
    }
    if (args.action === "create") {
      const objective = args.objective?.join(" ").trim()
      if (!objective || objective.length > 32768) throw new Error("Provide an objective of 1–32768 characters")
      if (args.budget !== undefined && (!Number.isSafeInteger(args.budget) || args.budget < 1))
        throw new Error("--budget must be a positive safe integer")
      const selected = selection()
      const id = args.id ?? `goal_${crypto.randomUUID().replaceAll("-", "")}`
      if (!/^goal_[a-zA-Z0-9]+$/.test(id)) throw new Error("--id must be a Goal ID")
      const sessionID =
        args.session ?? (await client.session.create({ title: objective.slice(0, 100) }, options)).data.id
      const created = (
        await client.goal.create({ sessionID, goalCreate: { id, objective, tokenBudget: args.budget } }, options)
      ).data
      // Emit the durable identity before starting so a failed network request can be retried explicitly.
      console.error(`Session: ${sessionID}\nGoal: ${created.id}`)
      console.log(
        JSON.stringify(
          (await client.goal.start({ sessionID, goalID: created.id, goalStart: selected }, options)).data,
          null,
          2,
        ),
      )
      return
    }
    if (!args.session) throw new Error("Provide --session for this operation")
    const current = (await client.goal.get({ sessionID: args.session }, options)).data
    if (args.action === "status") {
      console.log(JSON.stringify(current, null, 2))
      return
    }
    if (args.action === "reports" || args.action === "report" || args.action === "cleanup-reports") {
      const goalID = args.id ?? current?.id
      if (!goalID) throw new Error("Provide --id for reports of a cleared goal")
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
      if (!args.report || !args.file) throw new Error("Provide --report and --file")
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
    if (!current) throw new Error("This session has no goal")
    if (args.id && args.id !== current.id) throw new Error("The goal was replaced; the supplied --id is stale")
    const target = { sessionID: args.session, goalID: current.id }
    const result =
      args.action === "start"
        ? await client.goal.start({ ...target, goalStart: current.launch ?? selection() }, options)
        : await client.goal[args.action](target, options)
    console.log(JSON.stringify(result.data, null, 2))
  },
})
