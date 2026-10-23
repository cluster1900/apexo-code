import "@apexo/core/flag/apexo-env"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCommand } from "./cli/cmd/agent"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@apexo/core/installation/version"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/attach"
import { TuiThreadCommand } from "./cli/cmd/tui"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import { JsonlCommand } from "./cli/cmd/jsonl"
import { errorMessage } from "./util/error"
import { PluginCommand } from "./cli/cmd/plug"
import { Heap } from "./cli/heap"
import { PluginsCommand, grokPluginArgs } from "./cli/cmd/plugins"
import { MemoryCommand } from "./cli/cmd/memory"
import { GoalCommand } from "./cli/cmd/goal"
import { UsageCommand } from "./cli/cmd/usage"
import { TraceCommand } from "./cli/cmd/trace"
import { CompletionCommand } from "./cli/cmd/completion"

const args = grokPluginArgs(hideBin(process.argv))

function show(out: string, stream: NodeJS.WriteStream = process.stdout) {
  const text = out.trimStart()
  if (!text.startsWith("apexo ")) {
    stream.write(UI.logo() + EOL + EOL)
    stream.write(UI.TAGLINE + EOL + EOL)
    stream.write(text + EOL)
    return
  }
  stream.write(out)
}

function normalizeUnknownArgsMessage(msg: string, rawArgs: string[]) {
  const match = /^Unknown arguments?: (.+)$/.exec(msg)
  if (!match) return msg
  const items = match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  const rawFlags = new Set(
    rawArgs
      .filter((arg) => arg.startsWith("-"))
      .map((arg) => arg.replace(/^--?(?:no-)?/, "").split("=")[0]),
  )
  const camelExpansions = new Set(
    items
      .filter((item) => item.includes("-"))
      .map((item) => item.replace(/-([a-z0-9])/gi, (_, c: string) => c.toUpperCase())),
  )
  const filtered = items.filter((item) => !camelExpansions.has(item) || rawFlags.has(item))
  const finalItems = filtered.length > 0 ? filtered : items
  return `Unknown argument${finalItems.length === 1 ? "" : "s"}: ${finalItems.join(", ")}`
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("apexo")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .option("memory", {
    describe: "enable memory; --no-memory force-disables it for this process",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.memory !== undefined) process.env.GROK_MEMORY = opts.memory ? "1" : "0"
    if (opts.printLogs) process.env.APEXO_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.APEXO_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.APEXO_PURE = "1"
    }

    Heap.start()

    process.env.AGENT = "1"
    process.env.APEXO = "1"
    process.env.APEXO = "1"
    process.env.APEXO_PID = String(process.pid)
  })
  .usage("")
  .command(CompletionCommand)
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(ProvidersCommand)
  .command(AgentCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(UsageCommand)
  .command(TraceCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(PluginCommand)
  .command(DbCommand)
  .command(JsonlCommand)
  .command(MemoryCommand)
  .command(GoalCommand)
  .command(PluginsCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp((out) => show(out, process.stderr))
    }
    if (err) throw err
    if (msg) {
      UI.empty()
      UI.error(normalizeUnknownArgsMessage(msg, args))
    }
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  if (process.stdout.writableLength > 0) {
    await new Promise<void>((resolve) => process.stdout.once("drain", resolve))
  }
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit(process.exitCode)
}
