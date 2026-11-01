import { existsSync } from "node:fs"
import { EOL } from "node:os"
import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { type ParseError, parse } from "jsonc-parser"
import { Catalog } from "@apexo/core/catalog"
import { CommandSandbox } from "@apexo/core/command-sandbox"
import { Config } from "@apexo/core/config"
import { FSUtil } from "@apexo/core/fs-util"
import { Global } from "@apexo/core/global"
import { LEGACY_CONFIG_DIR, LEGACY_CONFIG_NAME } from "@apexo/core/legacy-compat"
import { Location } from "@apexo/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@apexo/core/location-services"
import { MCP } from "@apexo/core/mcp"
import { PermissionV2 } from "@apexo/core/permission"
import { AbsolutePath } from "@apexo/core/schema"
import { BashApproval } from "@apexo/core/tool/bash-approval"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { ConfigMigrateV1 } from "@apexo/core/v1/config/migrate"
import { CliError, effectCmd, fail } from "../effect-cmd"

export type DoctorCheckStatus = "ok" | "warn" | "error"

export interface DoctorCheckItem {
  readonly id: "git" | "ripgrep" | "sandbox" | "config" | "providers" | "mcp"
  readonly status: DoctorCheckStatus
  readonly summary: string
  readonly details?: Record<string, unknown>
}

export interface DoctorReport {
  readonly status: DoctorCheckStatus
  readonly directory: string
  readonly checks: ReadonlyArray<DoctorCheckItem>
}

export interface DoctorCommandPolicyReport {
  readonly command: string
  readonly effectiveCommand: string
  readonly shell: string
  readonly agent: string
  readonly effect: "allow" | "ask" | "deny"
  readonly opaque: boolean
  readonly exactGranted: boolean
  readonly segments: ReadonlyArray<{
    readonly resource: string
    readonly effect: "allow" | "ask" | "deny"
    readonly rule: {
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "ask" | "deny"
    }
  }>
  readonly save: ReadonlyArray<string>
}

const defaultShell = () => (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")

function probeBinary(binary: string, args = ["--version"]): { path: string; version: string } | undefined {
  const resolved = Bun.which(binary) ?? (existsSync(binary) ? binary : null)
  if (!resolved) return undefined
  const proc = Bun.spawnSync([resolved, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  if (proc.exitCode !== 0) return undefined
  const line = new TextDecoder().decode(proc.stdout).trim().split(/\r?\n/)[0]?.trim() ?? ""
  return { path: resolved, version: line }
}

const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const
const decodeInfo = Schema.decodeUnknownOption(Config.Info, decodeOptions)
const decodeV1Info = Schema.decodeUnknownOption(ConfigV1.Info, decodeOptions)

const inspectConfigFiles = Effect.fn("Cli.doctor.inspectConfigFiles")(function* (
  fs: FSUtil.Interface,
  location: Location.Interface,
  globalConfigDir: string,
) {
  const names = [`${LEGACY_CONFIG_NAME}.json`, `${LEGACY_CONFIG_NAME}.jsonc`, "apexo.json", "apexo.jsonc"]
  const configDirs = [".apexo", LEGACY_CONFIG_DIR]
  const locationIsGlobal = path.resolve(location.directory) === path.resolve(globalConfigDir)
  const discovered = locationIsGlobal
    ? []
    : yield* fs
        .up({
          targets: [...configDirs, ...names],
          start: location.directory,
          stop: location.project.directory,
        })
        .pipe(Effect.orDie)

  const candidates = new Set<string>(names.map((name) => path.join(globalConfigDir, name)))
  for (const item of discovered) {
    if (configDirs.includes(path.basename(item))) {
      for (const name of names) candidates.add(path.join(item, name))
      continue
    }
    candidates.add(item)
  }

  const validFiles: string[] = []
  const invalidFiles: Array<{ path: string; reason: string }> = []
  for (const filepath of candidates) {
    const raw = yield* fs.readFileStringSafe(filepath)
    if (raw === undefined) continue
    const text = raw.replace(/\{env:([^}]+)\}/g, (_, varName: string) => process.env[varName] || "")
    const errors: ParseError[] = []
    const input: unknown = parse(text, errors, { allowTrailingComma: true })
    if (errors.length > 0) {
      invalidFiles.push({
        path: filepath,
        reason: `JSONC syntax error at offset ${errors[0]!.offset}`,
      })
      continue
    }
    const decoded = Option.getOrUndefined(
      ConfigMigrateV1.isV1(input)
        ? decodeV1Info(input).pipe(Option.map(ConfigMigrateV1.migrate), Option.flatMap(decodeInfo))
        : decodeInfo(input),
    )
    if (!decoded) {
      invalidFiles.push({
        path: filepath,
        reason: "Schema validation failed against Config.Info",
      })
      continue
    }
    validFiles.push(filepath)
  }
  return { validFiles, invalidFiles }
})

export const evaluateDoctorCommandPolicy = Effect.fn("Cli.doctor.checkCommand")(function* (input: {
  readonly command: string
  readonly agent?: string
}) {
  const config = yield* Config.Service
  const permission = yield* PermissionV2.Service
  const entries = yield* config.entries()
  const settings = Config.latest(entries, "toolset")?.bash
  const shell = Config.latest(entries, "shell") ?? defaultShell()
  const separator = process.platform === "win32" && /(?:^|[\\/])powershell(?:\.exe)?$/i.test(shell) ? ";" : "&&"
  const rawCommand =
    settings?.cmd_prefix === undefined ? input.command : `${settings.cmd_prefix} ${separator} ${input.command}`
  const parsed = yield* Effect.promise(() => BashApproval.analyze(rawCommand, BashApproval.shellKind(shell)))
  const evaluated = yield* permission.evaluateOffline({
    action: "bash",
    resources: parsed.resources,
    ...(parsed.opaque ? {} : { exactResource: rawCommand }),
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
  })
  if (input.agent !== undefined && !evaluated.agentFound) {
    return yield* fail(`Unknown agent: ${input.agent}`)
  }
  return {
    command: input.command,
    effectiveCommand: rawCommand,
    shell,
    agent: evaluated.agent,
    effect: evaluated.effect,
    opaque: parsed.opaque,
    exactGranted: evaluated.exactGranted,
    segments: evaluated.segments,
    save: [...parsed.save],
  } satisfies DoctorCommandPolicyReport
})

export const collectDoctorReport = Effect.fn("Cli.doctor.collect")(function* () {
  const fs = yield* FSUtil.Service
  const location = yield* Location.Service
  const sandbox = yield* CommandSandbox.Service
  const catalog = yield* Catalog.Service
  const mcp = yield* MCP.Service
  const global = Option.getOrElse(yield* Effect.serviceOption(Global.Service), () => Global.make())

  const gitInfo = probeBinary("git")
  const gitCheck: DoctorCheckItem = gitInfo
    ? { id: "git", status: "ok", summary: gitInfo.version || gitInfo.path, details: gitInfo }
    : { id: "git", status: "warn", summary: "git executable not found on PATH" }

  const bundledRg = path.join(global.bin, process.platform === "win32" ? "rg.exe" : "rg")
  const rgInfo = probeBinary("rg") ?? probeBinary(bundledRg)
  const rgCheck: DoctorCheckItem = rgInfo
    ? { id: "ripgrep", status: "ok", summary: rgInfo.version || rgInfo.path, details: rgInfo }
    : {
        id: "ripgrep",
        status: "warn",
        summary: "ripgrep (rg) not pre-installed locally; Apexo will download it on first search",
      }

  const sandboxBackend = process.platform === "darwin" ? "seatbelt" : process.platform === "linux" ? "bwrap" : "none"
  const sandboxCheck = yield* sandbox.preflight("workspace").pipe(
    Effect.map(
      (policy): DoctorCheckItem => ({
        id: "sandbox",
        status: "ok",
        summary: `${sandboxBackend} available (profile: ${policy.profile})`,
        details: { backend: sandboxBackend, profile: policy.profile },
      }),
    ),
    Effect.catchTag("CommandSandbox.Failure", (error) =>
      Effect.succeed<DoctorCheckItem>({
        id: "sandbox",
        status: "warn",
        summary: `${sandboxBackend}: ${error.message}`,
        details: { backend: sandboxBackend, code: error.code },
      }),
    ),
  )

  const configResult = yield* inspectConfigFiles(fs, location, global.config)
  const configCheck: DoctorCheckItem =
    configResult.invalidFiles.length > 0
      ? {
          id: "config",
          status: "error",
          summary: `${configResult.invalidFiles.length} invalid config file(s): ${configResult.invalidFiles.map((item) => `${item.path} (${item.reason})`).join("; ")}`,
          details: configResult,
        }
      : {
          id: "config",
          status: "ok",
          summary:
            configResult.validFiles.length > 0
              ? `${configResult.validFiles.length} valid config file(s) loaded`
              : "No custom config files found (using defaults)",
          details: configResult,
        }

  const availableProviders = (yield* catalog.provider.available()).toSorted((a, b) => a.id.localeCompare(b.id))
  const defaultModel = yield* catalog.model.default()
  const providerCheck: DoctorCheckItem =
    availableProviders.length > 0
      ? {
          id: "providers",
          status: "ok",
          summary: `${availableProviders.length} provider(s) ready (${availableProviders.map((item) => item.id).join(", ")})${defaultModel ? `; default model: ${defaultModel.providerID}/${defaultModel.id}` : ""}`,
          details: {
            providers: availableProviders.map((item) => item.id),
            ...(defaultModel ? { defaultModel: `${defaultModel.providerID}/${defaultModel.id}` } : {}),
          },
        }
      : {
          id: "providers",
          status: "warn",
          summary: "No authenticated model providers detected",
          details: { providers: [] },
        }

  const mcpStatus = yield* mcp.status
  const mcpCatalog = yield* mcp.toolCatalog
  const mcpEntries = Object.entries(mcpStatus)
  const failedServers = mcpEntries.filter(([, value]) => value.status === "failed")
  const authServers = mcpEntries.filter(([, value]) => value.status === "needs_auth")
  const connectedCount = mcpEntries.filter(([, value]) => value.status === "connected").length
  const mcpCheck: DoctorCheckItem =
    failedServers.length > 0
      ? {
          id: "mcp",
          status: "error",
          summary: `${failedServers.length} MCP server(s) failed: ${failedServers.map(([name, s]) => `${name} (${s.status === "failed" ? s.error : s.status})`).join("; ")}`,
          details: { servers: mcpStatus, tools: mcpCatalog.length },
        }
      : authServers.length > 0
        ? {
            id: "mcp",
            status: "warn",
            summary: `${authServers.length} MCP server(s) require authentication: ${authServers.map(([name]) => name).join(", ")}`,
            details: { servers: mcpStatus, tools: mcpCatalog.length },
          }
        : {
            id: "mcp",
            status: "ok",
            summary:
              mcpEntries.length === 0
                ? "No MCP servers configured"
                : `${connectedCount}/${mcpEntries.length} MCP server(s) connected (${mcpCatalog.length} tools)`,
            details: { servers: mcpStatus, tools: mcpCatalog.length },
          }

  const checks: ReadonlyArray<DoctorCheckItem> = [
    gitCheck,
    rgCheck,
    sandboxCheck,
    configCheck,
    providerCheck,
    mcpCheck,
  ]
  const status: DoctorCheckStatus = checks.some((item) => item.status === "error")
    ? "error"
    : checks.some((item) => item.status === "warn")
      ? "warn"
      : "ok"

  return {
    status,
    directory: location.directory,
    checks,
  } satisfies DoctorReport
})

function formatReport(report: DoctorReport): string {
  const icon = (status: DoctorCheckStatus) => (status === "ok" ? "[OK]" : status === "warn" ? "[WARN]" : "[ERR]")
  const lines = [
    `Apexo Doctor (${report.directory})`,
    ...report.checks.map((item) => `  ${icon(item.status).padEnd(6)} ${item.id.padEnd(10)} ${item.summary}`),
    `Status: ${report.status.toUpperCase()}`,
  ]
  return lines.join(EOL) + EOL
}

function formatCommandPolicy(report: DoctorCommandPolicyReport): string {
  const lines = [
    `Command:  ${report.effectiveCommand}`,
    `Agent:    ${report.agent}`,
    `Decision: ${report.effect.toUpperCase()}`,
    `Parsing:  ${report.opaque ? "opaque whole-script" : `decomposed (${report.segments.length} segment(s))`}${report.exactGranted ? " [exact saved grant]" : ""}`,
    ...report.segments.map(
      (segment) =>
        `  - ${segment.resource} -> ${segment.effect} (rule: ${segment.rule.action} "${segment.rule.resource}" => ${segment.rule.effect})`,
    ),
    ...(report.save.length > 0 ? [`Save:     ${report.save.join(", ")}`] : []),
  ]
  return lines.join(EOL) + EOL
}

export const DoctorCommand = effectCmd({
  command: "doctor",
  describe: "check environment health, config validity, sandbox readiness, and command permissions",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("dir", {
        type: "string",
        describe: "workspace directory to inspect",
      })
      .option("json", {
        type: "boolean",
        describe: "emit structured JSON output",
        default: false,
      })
      .option("check-command", {
        type: "string",
        describe: "evaluate how bash permission rules classify a shell command without executing it",
      })
      .option("agent", {
        type: "string",
        describe: "agent ID to evaluate --check-command against",
      }),
  handler: (args) => {
    const directory = path.resolve(args.dir ?? process.cwd())
    if (!existsSync(directory)) return fail(`Directory does not exist: ${directory}`)
    const checkCommand = args["check-command"]
    return Effect.gen(function* () {
      if (checkCommand !== undefined) {
        const result = yield* evaluateDoctorCommandPolicy({
          command: checkCommand,
          ...(args.agent !== undefined ? { agent: args.agent } : {}),
        })
        process.stdout.write(args.json ? JSON.stringify(result, null, 2) + EOL : formatCommandPolicy(result))
        return
      }
      const report = yield* collectDoctorReport()
      process.stdout.write(args.json ? JSON.stringify(report, null, 2) + EOL : formatReport(report))
      if (report.status === "error") process.exitCode = 1
    }).pipe(
      Effect.withSpan("Cli.doctor"),
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
