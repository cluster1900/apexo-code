export * as Bwrap from "./linux"

import { randomBytes } from "node:crypto"
import { realpathSync } from "node:fs"
import path from "node:path"
import { Duration } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { AppProcess } from "../process"
import { LINUX_TCP_TO_UNIX_BRIDGE_SCRIPT } from "./network-proxy"
import type { Seatbelt } from "./seatbelt"

export type Input = Seatbelt.Input

const STRICT_SYSTEM_DIRS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"]
const CORE_PATH_ENTRIES = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"]

function buildSandboxPath(workspace: string, temporary: string): string {
  const seen = new Set(CORE_PATH_ENTRIES)
  const fromEnv = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry.length > 0 &&
        path.isAbsolute(entry) &&
        !entry.includes("\0") &&
        !entry.includes("\n") &&
        !entry.includes(path.delimiter) &&
        entry !== workspace &&
        !entry.startsWith(workspace + path.sep) &&
        entry !== temporary &&
        !entry.startsWith(temporary + path.sep) &&
        !seen.has(entry) &&
        (seen.add(entry), true),
    )
  return [...CORE_PATH_ENTRIES, ...fromEnv].join(path.delimiter)
}

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
  const proxyUnixSocket = network === "off" ? input.proxyUnixSocket : undefined
  if (proxyUnixSocket !== undefined && (!path.isAbsolute(proxyUnixSocket) || proxyUnixSocket.includes("\0")))
    throw new Error("Sandbox proxy unix socket must be an absolute path")
  const bridgeHostBinary = proxyUnixSocket ? (input.proxyBridgeBinary ?? realpathSync(process.execPath)) : undefined
  const bridgeSandboxBinary = proxyUnixSocket ? path.join(input.temporary, ".apexo-proxy-bridge") : undefined
  const marker = `APEXO_COMMAND_SANDBOX_${randomBytes(24).toString("hex")}\n`
  const launcherScript = proxyUnixSocket
    ? [
        'PROXY_PORT=$(BUN_BE_BUN=1 "$4" -e "$5" "$6" 3>&1 </dev/null >/dev/null 2>&1 &)',
        "case \"$PROXY_PORT\" in ''|*[!0-9]*) exit 126 ;; esac",
        'PROXY_URL="http://127.0.0.1:$PROXY_PORT"',
        'export HTTP_PROXY="$PROXY_URL" HTTPS_PROXY="$PROXY_URL" ALL_PROXY="$PROXY_URL"',
        'export http_proxy="$PROXY_URL" https_proxy="$PROXY_URL" all_proxy="$PROXY_URL" NO_PROXY="" no_proxy=""',
        'printf "%s" "$1"; exec "$2" -c "$3"',
      ].join("; ")
    : 'printf "%s" "$1"; exec "$2" -c "$3"'
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
    ...(bridgeHostBinary && bridgeSandboxBinary ? ["--ro-bind", bridgeHostBinary, bridgeSandboxBinary] : []),
    ...readOnly.flatMap((dir) => ["--ro-bind-try", dir, dir]),
    ...readWrite.flatMap((dir) => ["--bind-try", dir, dir]),
    ...input.protected.flatMap((prot) => ["--ro-bind-try", prot, prot]),
    ...denyLiterals.flatMap((deny) => ["--perms", "0000", "--tmpfs", deny]),
    "--chdir",
    input.cwd,
    "--",
    "/bin/sh",
    "-c",
    launcherScript,
    "apexo-command-sandbox",
    marker,
    input.shell,
    input.command,
    ...(proxyUnixSocket && bridgeSandboxBinary
      ? [bridgeSandboxBinary, LINUX_TCP_TO_UNIX_BRIDGE_SCRIPT, proxyUnixSocket]
      : []),
  ]
  const command = ChildProcess.make("bwrap", args, {
    cwd: input.cwd,
    shell: false,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: buildSandboxPath(input.workspace, input.temporary),
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
