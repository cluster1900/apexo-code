export * as Seatbelt from "./seatbelt"

import { randomBytes } from "node:crypto"
import path from "node:path"
import { Duration } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { AppProcess } from "../process"

import type { CommandSandboxPolicy } from "./policy"

export interface Input {
  readonly workspace: string
  readonly temporary: string
  readonly home: string
  readonly profile: string
  readonly base?: CommandSandboxPolicy.BaseProfile
  readonly network?: "off" | "unrestricted"
  readonly protected: ReadonlyArray<string>
  readonly ancestors: ReadonlyArray<string>
  readonly readOnly?: ReadonlyArray<string>
  readonly readWrite?: ReadonlyArray<string>
  readonly denyLiterals?: ReadonlyArray<string>
  readonly denyGlobs?: ReadonlyArray<CommandSandboxPolicy.DenyGlob>
  readonly shell: string
  readonly command: string
  readonly cwd: string
}

const STRICT_READ_SUBPATHS = [
  "/System",
  "/usr",
  "/bin",
  "/sbin",
  "/Library",
  "/opt/homebrew",
  "/etc",
  "/private/etc",
  "/var/select",
  "/private/var/select",
  "/dev",
  "/tmp",
  "/private/tmp",
  "/var/tmp",
  "/private/var/tmp",
  "/Users/Shared",
]

/** Only constant syntax enters the profile. Filesystem names are opaque -D parameters. */
export function prepare(input: Input) {
  const readOnly = input.readOnly ?? []
  const readWrite = input.readWrite ?? []
  const denyLiterals = input.denyLiterals ?? []
  const denyGlobs = input.denyGlobs ?? []
  const base =
    input.base ??
    (input.profile === "read-only" || input.profile === "strict" || input.profile === "devbox"
      ? input.profile
      : "workspace")
  const network = input.network ?? (base === "devbox" ? "unrestricted" : "off")
  const paths = [
    input.workspace,
    input.temporary,
    input.home,
    input.cwd,
    input.shell,
    ...input.protected,
    ...input.ancestors,
    ...readOnly,
    ...readWrite,
    ...denyLiterals,
  ]
  if (paths.some((value) => !path.isAbsolute(value) || value.includes("\0") || Buffer.byteLength(value) > 4096))
    throw new Error("Sandbox requires bounded absolute paths")
  if (
    input.protected.length > 256 ||
    input.ancestors.length > 256 ||
    readOnly.length > 128 ||
    readWrite.length > 128 ||
    denyLiterals.length > 128 ||
    denyGlobs.length > 128
  )
    throw new Error("Sandbox path policy exceeds its bound")
  if (denyGlobs.some((glob) => !glob.regex.startsWith("^") || glob.regex.includes("\0") || glob.regex.includes("\n")))
    throw new Error("Sandbox deny glob regex is invalid")
  const bindings = [
    ["WORKSPACE", input.workspace],
    ["TEMPORARY", input.temporary],
    ...input.protected.map((value, index) => [`PROTECTED_${index}`, value]),
    ...input.ancestors.map((value, index) => [`ANCESTOR_${index}`, value]),
    ...readOnly.map((value, index) => [`READ_ONLY_${index}`, value]),
    ...readWrite.map((value, index) => [`READ_WRITE_${index}`, value]),
    ...denyLiterals.map((value, index) => [`DENY_LITERAL_${index}`, value]),
  ]
  const allowsWorkspaceWrites = base === "workspace" || base === "devbox"
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read)",
    ...(network === "unrestricted" ? ["(allow network*)", "(allow system-socket)"] : []),
    ...(base === "strict"
      ? [
          '(allow file-read* (literal "/"))',
          ...STRICT_READ_SUBPATHS.map((subpath) => `(allow file-read* (subpath "${subpath}"))`),
          ...input.ancestors.map((_, index) => `(allow file-read-metadata (literal (param "ANCESTOR_${index}")))`),
          '(allow file-read* (subpath (param "TEMPORARY")))',
          '(allow file-read* (subpath (param "WORKSPACE")))',
          ...readOnly.map((_, index) => `(allow file-read* (subpath (param "READ_ONLY_${index}")))`),
          ...readWrite.map((_, index) => `(allow file-read* (subpath (param "READ_WRITE_${index}")))`),
        ]
      : ["(allow file-read*)"]),
    '(allow file-write-data (literal "/dev/null"))',
    '(allow file-write* (subpath (param "TEMPORARY")))',
    '(deny file-write-unlink (literal (param "TEMPORARY")))',
    ...(allowsWorkspaceWrites ? ['(allow file-write* (subpath (param "WORKSPACE")))'] : []),
    ...readWrite.map((_, index) => `(allow file-write* (subpath (param "READ_WRITE_${index}")))`),
    ...input.protected.map((_, index) => `(deny file-write* (subpath (param "PROTECTED_${index}")))`),
    ...input.ancestors.map((_, index) => `(deny file-write-unlink (literal (param "ANCESTOR_${index}")))`),
    ...denyLiterals.flatMap((_, index) => [
      `(deny file-read* (subpath (param "DENY_LITERAL_${index}")))`,
      `(deny file-write* (subpath (param "DENY_LITERAL_${index}")))`,
    ]),
    ...denyGlobs.flatMap((glob) => {
      const escaped = glob.regex.replaceAll('"', '\\"')
      return [`(deny file-read* (regex #"${escaped}"))`, `(deny file-write* (regex #"${escaped}"))`]
    }),
    // Path policy does not isolate pre-existing hardlinks; new link creation is denied.
    "(deny file-link)",
  ].join("\n")
  const marker = `APEXO_COMMAND_SANDBOX_${randomBytes(24).toString("hex")}\n`
  const command = ChildProcess.make(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      profile,
      ...bindings.flatMap(([key, value]) => ["-D", `${key}=${value}`]),
      "--",
      "/bin/sh",
      "-c",
      // No user text is evaluated by the trusted launcher. No shell startup environment is forwarded.
      'printf "%s" "$1"; exec "$2" -c "$3"',
      "apexo-command-sandbox",
      marker,
      input.shell,
      input.command,
    ],
    {
      cwd: input.cwd,
      shell: false,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
        HOME: input.home,
        TMPDIR: input.temporary,
        LANG: "en_US.UTF-8",
      },
      extendEnv: false,
      detached: true,
      forceKillAfter: Duration.seconds(3),
    },
  )
  const prefix = Buffer.from(marker)
  const preview = { offset: 0, invalid: false }
  return {
    command,
    // Preview strips the private launch marker incrementally. Final confirmation
    // still validates the retained original stdout and records Session identity.
    preview: (chunk: AppProcess.OutputChunk) => {
      if (chunk.channel === "stderr") return chunk.data
      if (chunk.channel !== "stdout" || preview.invalid) return undefined
      const length = Math.min(prefix.length - preview.offset, chunk.data.length)
      if (
        !Buffer.from(chunk.data.subarray(0, length)).equals(prefix.subarray(preview.offset, preview.offset + length))
      ) {
        preview.invalid = true
        return undefined
      }
      preview.offset += length
      return preview.offset === prefix.length ? chunk.data.subarray(length) : undefined
    },
    confirm: (result: AppProcess.RunResult) => {
      if (result.stdout.length < prefix.length || !result.stdout.subarray(0, prefix.length).equals(prefix))
        return undefined
      return {
        ...result,
        stdout: result.stdout.subarray(prefix.length),
      }
    },
  }
}
