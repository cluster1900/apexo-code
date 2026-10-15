export * as Seatbelt from "./seatbelt"

import { randomBytes } from "node:crypto"
import path from "node:path"
import { Duration } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { AppProcess } from "../process"

export interface Input {
  readonly workspace: string
  readonly temporary: string
  readonly home: string
  readonly profile: "workspace" | "read-only"
  readonly protected: ReadonlyArray<string>
  readonly ancestors: ReadonlyArray<string>
  readonly shell: string
  readonly command: string
  readonly cwd: string
}

/** Only constant syntax enters the profile. Filesystem names are opaque -D parameters. */
export function prepare(input: Input) {
  const paths = [
    input.workspace,
    input.temporary,
    input.home,
    input.cwd,
    input.shell,
    ...input.protected,
    ...input.ancestors,
  ]
  if (paths.some((value) => !path.isAbsolute(value) || value.includes("\0") || Buffer.byteLength(value) > 4096))
    throw new Error("Sandbox requires bounded absolute paths")
  if (input.protected.length > 128 || input.ancestors.length > 128)
    throw new Error("Sandbox path policy exceeds its bound")
  const bindings = [
    ["WORKSPACE", input.workspace],
    ["TEMPORARY", input.temporary],
    ...input.protected.map((value, index) => [`PROTECTED_${index}`, value]),
    ...input.ancestors.map((value, index) => [`ANCESTOR_${index}`, value]),
  ]
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow file-read*)",
    '(allow file-write-data (literal "/dev/null"))',
    '(allow file-write* (subpath (param "TEMPORARY")))',
    '(deny file-write-unlink (literal (param "TEMPORARY")))',
    ...(input.profile === "workspace" ? ['(allow file-write* (subpath (param "WORKSPACE")))'] : []),
    ...input.protected.map((_, index) => `(deny file-write* (subpath (param "PROTECTED_${index}")))`),
    ...input.ancestors.map((_, index) => `(deny file-write-unlink (literal (param "ANCESTOR_${index}")))`),
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
