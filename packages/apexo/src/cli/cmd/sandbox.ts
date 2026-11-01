import { existsSync } from "node:fs"
import { EOL } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { CommandSandbox } from "@apexo/core/command-sandbox"
import { Location } from "@apexo/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@apexo/core/location-services"
import { AbsolutePath } from "@apexo/core/schema"
import { CliError, effectCmd, fail } from "../effect-cmd"

export interface SandboxExecReport {
  readonly backend: "seatbelt" | "bwrap"
  readonly profile: string
  readonly directory: string
  readonly network: "off" | "unrestricted"
  readonly allowDomains: ReadonlyArray<string>
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

function quoteShellArg(token: string): string {
  if (token.length > 0 && /^[A-Za-z0-9_./:@%+=,-]+$/.test(token)) return token
  return `'${token.replaceAll("'", "'\\''")}'`
}

function resolveShellCommand(explicit: string | undefined, tokens: ReadonlyArray<string>): string | undefined {
  if (explicit !== undefined) return explicit.trim() ? explicit : undefined
  if (tokens.length === 0) return undefined
  if (tokens.length === 1) return tokens[0]!.trim() ? tokens[0]! : undefined
  return tokens.map(quoteShellArg).join(" ")
}

export const SandboxCommand = effectCmd({
  command: "sandbox [cmd..]",
  describe: "run a shell command inside Apexo's native filesystem and network sandbox",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("cmd", {
        type: "string",
        array: true,
        default: [] as string[],
        describe: "command or arguments to execute inside the sandbox (prefer `-- <cmd...>` for flags)",
      })
      .option("command", {
        alias: ["c"],
        type: "string",
        describe: "shell script string to execute inside the sandbox",
      })
      .option("profile", {
        type: "string",
        default: "workspace",
        describe: "sandbox profile (workspace, read-only, strict, devbox, or custom profile in sandbox.toml)",
      })
      .option("allow-domain", {
        type: "string",
        array: true,
        describe: "allow outbound HTTP/HTTPS only to matching domain or *.domain wildcard via local proxy",
      })
      .option("network", {
        type: "string",
        choices: ["off", "unrestricted"] as const,
        describe: "override sandbox network policy (off or unrestricted)",
      })
      .option("dir", {
        type: "string",
        describe: "workspace directory to confine against",
      })
      .option("timeout", {
        type: "number",
        default: 120000,
        describe: "execution timeout in milliseconds",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "emit structured JSON execution receipt",
      }),
  handler: (args) => {
    const directory = path.resolve(args.dir ?? process.cwd())
    if (!existsSync(directory)) return fail(`Directory does not exist: ${directory}`)
    if (!Number.isInteger(args.timeout) || args.timeout <= 0) {
      return fail("--timeout must be a positive integer number of milliseconds")
    }
    const tokens = [...(args.cmd ?? []), ...(args["--"] ?? [])]
    if (args.command !== undefined && tokens.length > 0) {
      return fail("Specify either --command (-c) or positional command arguments, not both")
    }
    const shellCommand = resolveShellCommand(args.command, tokens)
    if (!shellCommand) {
      return fail("A command is required (e.g. `apexo sandbox --profile workspace -- ls -la`)")
    }
    const allowDomains = args["allow-domain"]

    return Effect.gen(function* () {
      const sandbox = yield* CommandSandbox.Service
      const location = yield* Location.Service
      const result = yield* sandbox.exec({
        profile: args.profile,
        command: shellCommand,
        timeoutMs: args.timeout,
        ...(allowDomains && allowDomains.length > 0 ? { allowDomains } : {}),
        ...(args.network !== undefined ? { network: args.network } : {}),
      })

      if (args.json) {
        const report: SandboxExecReport = {
          backend: result.backend,
          profile: result.profile,
          directory: location.directory,
          network: result.network,
          allowDomains: result.allowDomains,
          exitCode: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      }
      if (!args.json) {
        if (result.stdout.length > 0) process.stdout.write(result.stdout)
        if (result.stderr.length > 0) process.stderr.write(result.stderr)
      }
      if (result.exitCode !== 0) process.exitCode = result.exitCode
    }).pipe(
      Effect.withSpan("Cli.sandbox"),
      Effect.provide(
        LocationServiceMap.Service.get(
          Location.Ref.make({
            directory: AbsolutePath.make(directory),
          }),
        ),
      ),
      Effect.provide(locationServiceMapLayer),
      Effect.catch((error) =>
        error instanceof CliError ? Effect.fail(error) : fail(error instanceof Error ? error.message : String(error)),
      ),
    )
  },
})
