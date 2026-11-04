import { cmd } from "./cmd"
import { UI } from "../ui"

export const LocalQwenCommand = cmd({
  command: "local-qwen [action] [target]",
  describe: "manage local Qwen 0.8B edge accelerator (status | install | endpoint | enable | disable | remove)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "subcommand to run",
        type: "string",
        choices: ["status", "install", "download", "endpoint", "enable", "disable", "remove", "uninstall"] as const,
        default: "status",
      })
      .positional("target", {
        describe: "optional model download URL or local OpenAI-compatible /v1 endpoint URL",
        type: "string",
      }),
  handler: async (args) => {
    const { formatProgressBar, runLocalQwenCommand } = await import("@apexo/core/local-qwen")
    const raw = [args.action, args.target].filter(Boolean).join(" ")
    const isInstall = args.action === "install" || args.action === "download"
    const report = await runLocalQwenCommand(raw, {
      onProgress: (progress) => {
        if (!isInstall) return
        process.stderr.write(`\rDownloading Local Qwen 0.8B: ${formatProgressBar(progress)}   `)
        if (progress.percent === 100) process.stderr.write("\n")
      },
    })
    UI.println(report)
  },
})
