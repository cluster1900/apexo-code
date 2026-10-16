export * as Bwrap from "./linux"

import { randomBytes } from "node:crypto"
import path from "node:path"
import { Duration } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { AppProcess } from "../process"
import type { Seatbelt } from "./seatbelt"

export type Input = Seatbelt.Input

const STRICT_SYSTEM_DIRS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"]

export function prepare(input: Input) {
  const readOnly = input.readOnly ?? []
  const readWrite = input.readWrite ?? []
  const denyLiterals = input.denyLiterals ?? []
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
    denyLiterals.length > 128
  )
    throw new Error("Sandbox path policy exceeds its bound")
  const allowsWorkspaceWrites = base === "workspace" || base === "devbox"
  const args = [
    "--die-with-parent",
    "--unshare-pid",
    ...(network === "off" ? ["--unshare-net"] : []),
    ...(base === "strict"
      ? [
          ...STRICT_SYSTEM_DIRS.flatMap((dir) => ["--ro-bind-try", dir, dir]),
          "--dev",
          "/dev",
          "--proc",
          "/proc",
          "--tmpfs",
          "/tmp",
          ...(allowsWorkspaceWrites
            ? ["--bind", input.workspace, input.workspace]
            : ["--ro-bind", input.workspace, input.workspace]),
        ]
      : [
          "--ro-bind",
          "/",
          "/",
          "--dev",
          "/dev",
          "--proc",
          "/proc",
          ...(allowsWorkspaceWrites ? ["--bind", input.workspace, input.workspace] : []),
        ]),
    "--bind",
    input.temporary,
    input.temporary,
    ...readOnly.flatMap((dir) => ["--ro-bind-try", dir, dir]),
    ...readWrite.flatMap((dir) => ["--bind-try", dir, dir]),
    ...input.protected.flatMap((prot) => ["--ro-bind-try", prot, prot]),
    ...denyLiterals.flatMap((deny) => ["--perms", "0000", "--tmpfs", deny]),
    "--chdir",
    input.cwd,
    "--",
    "/bin/sh",
    "-c",
    'printf "%s" "$1"; exec "$2" -c "$3"',
    "apexo-command-sandbox",
    `APEXO_COMMAND_SANDBOX_${randomBytes(24).toString("hex")}\n`,
    input.shell,
    input.command,
  ]
  const marker = args[args.length - 3]!
  const command = ChildProcess.make("bwrap", args, {
    cwd: input.cwd,
    shell: false,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: input.home,
      TMPDIR: input.temporary,
      LANG: "C.UTF-8",
    },
    extendEnv: false,
    detached: true,
    forceKillAfter: Duration.seconds(3),
  })
  const prefix = Buffer.from(marker)
  const preview = { offset: 0, invalid: false }
  return {
    args,
    command,
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
