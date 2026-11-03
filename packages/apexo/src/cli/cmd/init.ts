import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { EOL } from "node:os"
import path from "node:path"
import { Effect, Option, Schema } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

const decodeJsonRecord = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)

export interface InitFileRecord {
  readonly kind: "agents" | "sandbox"
  readonly path: string
  readonly relativePath: string
  readonly status: "created" | "overwritten" | "skipped"
}

export interface InitDetectedStack {
  readonly projectName: string
  readonly stacks: ReadonlyArray<"javascript" | "python" | "rust" | "go">
  readonly packageManager?: "bun" | "pnpm" | "yarn" | "npm" | "uv" | "poetry" | "pip" | "cargo" | "go"
  readonly commands: {
    readonly install?: string
    readonly build?: string
    readonly test?: string
    readonly typecheck?: string
    readonly lint?: string
  }
  readonly allowDomains: ReadonlyArray<string>
}

export interface InitReport {
  readonly directory: string
  readonly detected: InitDetectedStack
  readonly files: ReadonlyArray<InitFileRecord>
}

async function detectWorkspaceStack(directory: string): Promise<InitDetectedStack> {
  const stacks: Array<"javascript" | "python" | "rust" | "go"> = []
  const allowDomains = new Set<string>()
  let projectName = path.basename(directory) || "workspace"
  let packageManager: InitDetectedStack["packageManager"]
  const commands: {
    install?: string
    build?: string
    test?: string
    typecheck?: string
    lint?: string
  } = {}

  const pkgPath = path.join(directory, "package.json")
  if (existsSync(pkgPath)) {
    stacks.push("javascript")
    allowDomains.add("registry.npmjs.org")
    allowDomains.add("*.npmjs.org")
    const jsPm =
      existsSync(path.join(directory, "bun.lock")) || existsSync(path.join(directory, "bun.lockb"))
        ? ("bun" as const)
        : existsSync(path.join(directory, "pnpm-lock.yaml"))
          ? ("pnpm" as const)
          : existsSync(path.join(directory, "yarn.lock"))
            ? ("yarn" as const)
            : ("npm" as const)
    packageManager = jsPm
    commands.install = `${jsPm} install`
    const runPrefix = jsPm === "npm" ? "npm run" : `${jsPm} run`
    const rawPkg = await Bun.file(pkgPath)
      .text()
      .catch(() => "")
    const parsedPkg = decodeJsonRecord(rawPkg)
    if (Option.isSome(parsedPkg)) {
      if (typeof parsedPkg.value.name === "string" && parsedPkg.value.name.trim()) {
        projectName = parsedPkg.value.name.trim()
      }
      const scripts =
        typeof parsedPkg.value.scripts === "object" &&
        parsedPkg.value.scripts !== null &&
        !Array.isArray(parsedPkg.value.scripts)
          ? (parsedPkg.value.scripts as Record<string, unknown>)
          : {}
      if (typeof scripts.build === "string") commands.build = `${runPrefix} build`
      if (typeof scripts.test === "string") commands.test = `${runPrefix} test`
      else if (jsPm === "bun") commands.test = "bun test"
      if (typeof scripts.typecheck === "string") commands.typecheck = `${runPrefix} typecheck`
      else if (typeof scripts.check === "string") commands.typecheck = `${runPrefix} check`
      if (typeof scripts.lint === "string") commands.lint = `${runPrefix} lint`
    }
  }

  if (existsSync(path.join(directory, "Cargo.toml"))) {
    stacks.push("rust")
    allowDomains.add("crates.io")
    allowDomains.add("static.crates.io")
    allowDomains.add("index.crates.io")
    packageManager ??= "cargo"
    commands.build ??= "cargo build"
    commands.test ??= "cargo test"
    commands.typecheck ??= "cargo check"
    commands.lint ??= "cargo clippy"
  }

  const hasPyproject = existsSync(path.join(directory, "pyproject.toml"))
  const hasRequirements = existsSync(path.join(directory, "requirements.txt"))
  if (hasPyproject || hasRequirements) {
    stacks.push("python")
    allowDomains.add("pypi.org")
    allowDomains.add("files.pythonhosted.org")
    const pyPm = existsSync(path.join(directory, "uv.lock"))
      ? ("uv" as const)
      : existsSync(path.join(directory, "poetry.lock"))
        ? ("poetry" as const)
        : ("pip" as const)
    packageManager ??= pyPm
    commands.install ??=
      pyPm === "uv"
        ? "uv sync"
        : pyPm === "poetry"
          ? "poetry install"
          : hasRequirements
            ? "pip install -r requirements.txt"
            : "pip install -e ."
    const pyConfigFiles = [
      "pyproject.toml",
      "requirements.txt",
      "requirements-dev.txt",
      "dev-requirements.txt",
      "setup.cfg",
      "tox.ini",
    ]
    const pyConfigTexts = await Promise.all(
      pyConfigFiles.map((name) => {
        const candidate = path.join(directory, name)
        return existsSync(candidate)
          ? Bun.file(candidate)
              .text()
              .catch(() => "")
          : Promise.resolve("")
      }),
    )
    const pyConfigText = pyConfigTexts.join("\n")
    const hasPytest =
      existsSync(path.join(directory, "pytest.ini")) ||
      existsSync(path.join(directory, "conftest.py")) ||
      /\bpytest\b/i.test(pyConfigText)
    if (hasPytest) {
      commands.test ??= pyPm === "uv" ? "uv run pytest" : pyPm === "poetry" ? "poetry run pytest" : "pytest"
    } else if (/\bunittest\b/i.test(pyConfigText)) {
      commands.test ??= "python3 -m unittest"
    }
    const hasRuff =
      existsSync(path.join(directory, "ruff.toml")) ||
      existsSync(path.join(directory, ".ruff.toml")) ||
      /\bruff\b/i.test(pyConfigText)
    if (hasRuff) {
      commands.lint ??=
        pyPm === "uv" ? "uv run ruff check ." : pyPm === "poetry" ? "poetry run ruff check ." : "ruff check ."
    } else if (/\bflake8\b/i.test(pyConfigText)) {
      commands.lint ??= pyPm === "uv" ? "uv run flake8" : pyPm === "poetry" ? "poetry run flake8" : "flake8"
    }
    const hasPyright = existsSync(path.join(directory, "pyrightconfig.json")) || /\bpyright\b/i.test(pyConfigText)
    const hasMypy =
      existsSync(path.join(directory, "mypy.ini")) ||
      existsSync(path.join(directory, ".mypy.ini")) ||
      /\bmypy\b/i.test(pyConfigText)
    if (hasPyright) {
      commands.typecheck ??= pyPm === "uv" ? "uv run pyright" : pyPm === "poetry" ? "poetry run pyright" : "pyright"
    } else if (hasMypy) {
      commands.typecheck ??= pyPm === "uv" ? "uv run mypy ." : pyPm === "poetry" ? "poetry run mypy ." : "mypy ."
    }
  }

  if (existsSync(path.join(directory, "go.mod"))) {
    stacks.push("go")
    allowDomains.add("proxy.golang.org")
    allowDomains.add("sum.golang.org")
    packageManager ??= "go"
    commands.build ??= "go build ./..."
    commands.test ??= "go test ./..."
    commands.lint ??= "go vet ./..."
  }

  if (allowDomains.size === 0) {
    allowDomains.add("registry.npmjs.org")
  }

  return {
    projectName,
    stacks,
    ...(packageManager ? { packageManager } : {}),
    commands,
    allowDomains: [...allowDomains],
  }
}

function renderAgentsMd(detected: InitDetectedStack): string {
  const commandLines = [
    detected.commands.install ? `- **Install**: \`${detected.commands.install}\`` : undefined,
    detected.commands.build ? `- **Build**: \`${detected.commands.build}\`` : undefined,
    detected.commands.typecheck ? `- **Typecheck**: \`${detected.commands.typecheck}\`` : undefined,
    detected.commands.test
      ? `- **Test**: \`${detected.commands.test}\``
      : `- **Test**: Add the project's test command here${
          detected.stacks.includes("python") ? " (e.g. `python3 -m unittest discover` or `pytest`)" : ""
        }.`,
    detected.commands.lint ? `- **Lint**: \`${detected.commands.lint}\`` : undefined,
  ].filter((line): line is string => line !== undefined)

  return [
    `# ${detected.projectName} — Agent Guidelines`,
    "",
    "## Verification & Commands",
    "",
    ...(commandLines.length > 0
      ? commandLines
      : ["- Run project tests and typechecks before finalizing changes."]),
    "",
    "## Working Principles",
    "",
    "- Keep changes focused and minimal; avoid speculative abstractions or unrelated refactors.",
    "- Verify changes using the commands above before concluding a task.",
    "- Preserve existing conventions, formatting, and public interfaces unless explicitly asked to change them.",
    "",
    "## Command Sandbox",
    "",
    "- Custom command sandbox profiles (`pkg-install`, `ci-verify`) are configured in `.apexo/sandbox.toml`.",
    "- When a non-`off` command sandbox profile is enabled, its `[filesystem]` `deny` rules restrict sandboxed commands and tools from accessing `.env` and `.env.*` files (including in subdirectories). Sessions started with sandbox `off` (the default when `--sandbox` is omitted) do not enforce these rules.",
    "- Start with `--sandbox pkg-install` (workspace writes + package registry network access) or `--sandbox ci-verify` (read-only verification), e.g. `apexo --sandbox pkg-install` or `apexo run --sandbox ci-verify \"...\"`.",
    "- A Session's sandbox profile is fixed at creation time. In native TUI (`apexo --session-protocol native` or `apexo --sandbox pkg-install`), `/sandbox <profile>` only sets the profile for future Sessions (run `/new` to start a new Session with that profile).",
    "",
  ].join("\n")
}

function renderSandboxToml(detected: InitDetectedStack): string {
  const domainsList = detected.allowDomains.map((domain) => JSON.stringify(domain)).join(", ")
  return [
    "# Apexo Command Sandbox Configuration",
    "# Usage: `apexo --sandbox pkg-install`, `apexo run --sandbox ci-verify \"...\"`, or in native TUI use `/sandbox <profile>` before `/new`.",
    "",
    "[filesystem]",
    "# When a non-`off` sandbox profile is enabled, deny sandboxed access to .env files at the workspace root and in subdirectories.",
    'deny = [".env", ".env.*", "**/.env", "**/.env.*"]',
    "",
    "[profiles.pkg-install]",
    'extends = "workspace"',
    `allow_domains = [${domainsList}]`,
    "",
    "[profiles.ci-verify]",
    'extends = "read-only"',
    "restrict_network = true",
    "",
  ].join("\n")
}

export const InitCommand = effectCmd({
  command: "init [dir]",
  describe: "scaffold AGENTS.md and .apexo/sandbox.toml for a repository",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("dir", {
        type: "string",
        describe: "target repository directory (defaults to current working directory)",
      })
      .option("dir", {
        type: "string",
        describe: "target repository directory",
      })
      .option("force", {
        alias: ["f"],
        type: "boolean",
        default: false,
        describe: "overwrite existing AGENTS.md and .apexo/sandbox.toml files",
      })
      .option("agents-only", {
        type: "boolean",
        default: false,
        describe: "generate only AGENTS.md",
      })
      .option("sandbox-only", {
        type: "boolean",
        default: false,
        describe: "generate only .apexo/sandbox.toml",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output structured JSON report",
      }),
  handler: (args) => {
    if (args["agents-only"] && args["sandbox-only"]) {
      return fail("Cannot combine --agents-only and --sandbox-only")
    }
    const targetDir = path.resolve(args.dir ?? process.cwd())
    if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
      return fail(`Directory does not exist: ${targetDir}`)
    }

    return Effect.promise(async () => {
      const detected = await detectWorkspaceStack(targetDir)
      const files: InitFileRecord[] = []

      if (!args["sandbox-only"]) {
        const existingEntry = readdirSync(targetDir).find((name) => name.toLowerCase() === "agents.md")
        const actualName = existingEntry ?? "AGENTS.md"
        const agentsPath = path.join(targetDir, actualName)
        const existed = existingEntry !== undefined || existsSync(agentsPath)
        if (existed && !args.force) {
          files.push({
            kind: "agents",
            path: agentsPath,
            relativePath: actualName,
            status: "skipped",
          })
        } else {
          const writePath =
            existed && existsSync(agentsPath)
              ? realpathSync.native(agentsPath)
              : existingEntry !== undefined && lstatSync(agentsPath).isSymbolicLink()
                ? path.resolve(targetDir, readlinkSync(agentsPath))
                : agentsPath
          await mkdir(path.dirname(writePath), { recursive: true })
          await Bun.write(writePath, renderAgentsMd(detected))
          files.push({
            kind: "agents",
            path: agentsPath,
            relativePath: actualName,
            status: existed ? "overwritten" : "created",
          })
        }
      }

      if (!args["agents-only"]) {
        const sandboxPath = path.join(targetDir, ".apexo", "sandbox.toml")
        const existed = existsSync(sandboxPath)
        if (existed && !args.force) {
          files.push({
            kind: "sandbox",
            path: sandboxPath,
            relativePath: ".apexo/sandbox.toml",
            status: "skipped",
          })
        } else {
          await mkdir(path.dirname(sandboxPath), { recursive: true })
          await Bun.write(sandboxPath, renderSandboxToml(detected))
          files.push({
            kind: "sandbox",
            path: sandboxPath,
            relativePath: ".apexo/sandbox.toml",
            status: existed ? "overwritten" : "created",
          })
        }
      }

      const report: InitReport = {
        directory: targetDir,
        detected,
        files,
      }

      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
        return
      }

      const stackSummary = detected.stacks.length > 0 ? detected.stacks.join(", ") : "generic"
      UI.println(`Initialized Apexo workspace in ${targetDir} (${stackSummary})`)
      for (const item of files) {
        const prefix = item.status === "skipped" ? "  - [skipped] " : `  + [${item.status}] `
        UI.println(`${prefix}${item.relativePath}`)
      }
    })
  },
})
