export * as MemoryFilesystem from "./memory-filesystem"

import { lstat, realpath, statfs } from "node:fs/promises"
import path from "node:path"

export class UnsupportedFilesystemError extends Error {
  constructor(readonly directory: string) {
    super(`Memory V2 requires a local filesystem with shared-memory coordination: ${directory}`)
    this.name = "UnsupportedMemoryFilesystemError"
  }
}

export async function requireLocal(directory: string) {
  // As in Grok, forcing WAL must not override a detected remote mount.
  if (process.env.GROK_SQLITE_JOURNAL_MODE?.toLowerCase() === "truncate" || (await network(directory)))
    throw new UnsupportedFilesystemError(directory)
}

// Detection is best-effort, matching Grok's policy for unknown filesystems.
// Call before opening SQLite, including diagnostic/advisory connections.
export async function network(directory: string): Promise<boolean> {
  if (process.platform === "win32" && windowsUNC(directory)) return true
  const existing = await ancestor(directory).catch(() => undefined)
  if (!existing) return false
  if (process.platform === "linux") {
    const info = await statfs(existing, { bigint: true }).catch(() => undefined)
    return info ? linuxNetwork(info.type) : false
  }
  if (process.platform === "darwin") {
    // Node statfs omits MNT_LOCAL and f_fstypename. The system mount listing
    // exposes both from getmntinfo(MNT_NOWAIT), without mounting anything.
    const output = await probe("/sbin/mount", []).catch(() => undefined)
    return output ? (macNetwork(output, existing) ?? false) : false
  }
  if (process.platform === "win32") {
    // Resolve the containing volume before GetDriveTypeW, so junctions and
    // mapped drives are classified by their actual volume, not their spelling.
    const command = `Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ApexoMemoryVolume {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
  public static extern bool GetVolumePathNameW(string path, StringBuilder volume, uint length);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern uint GetDriveTypeW(string volume);
}
'@
$volume = New-Object System.Text.StringBuilder 32768
if ([ApexoMemoryVolume]::GetVolumePathNameW($env:APEXO_MEMORY_VOLUME_PATH, $volume, 32768)) {
  [Console]::Write([ApexoMemoryVolume]::GetDriveTypeW($volume.ToString()))
}`
    const output = await probe(
      path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(command, "utf16le").toString("base64"),
      ],
      { APEXO_MEMORY_VOLUME_PATH: existing },
    ).catch(() => undefined)
    return output?.trim() === "4"
  }
  return false
}

export function linuxNetwork(type: bigint) {
  // Linux magic.h, plus Lustre/GPFS/WEKA; FUSE includes remote-backed homes.
  return [
    0x6969n,
    0x517bn,
    0xfe534d42n,
    0xff534d42n,
    0x01021997n,
    0x73757245n,
    0x5346414fn,
    0x6b414653n,
    0x00c36400n,
    0x0bd00bd0n,
    0x01161970n,
    0x47504653n,
    0x7461636fn,
    0x18031977n,
    0x65735546n,
  ].includes(BigInt.asUintN(32, type))
}

export function macNetwork(mounts: string, directory: string) {
  // Match the exact ancestor suffix rather than splitting at " on ": spaces,
  // parentheses and that delimiter are legal in both source and mount names.
  const records = [...mounts.matchAll(/([\s\S]*?) \(([^()\n]*)\)\r?\n/g)].map((record) => ({
    path: record[1]!,
    flags: record[2]!.split(", "),
  }))
  const parts = path.posix.resolve(directory).split("/")
  while (parts.length) {
    const target = parts.join("/") || "/"
    const record = records.findLast((record) => record.path.endsWith(` on ${target}`))
    if (record)
      return (
        !record.flags.includes("local") ||
        ["nfs", "smbfs", "cifs", "afpfs", "webdav", "macfuse", "osxfuse"].includes(record.flags[0]!.toLowerCase())
      )
    parts.pop()
  }
}

export function windowsUNC(directory: string) {
  const target = directory.replaceAll("/", "\\")
  if (!target.startsWith("\\\\")) return false
  if (target.startsWith("\\\\?\\")) return target.slice(4, 8).toUpperCase() === "UNC\\"
  return !target.startsWith("\\\\.\\")
}

async function ancestor(directory: string): Promise<string> {
  const exists = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  // Darwin aliases such as /var -> /private/var must match the canonical
  // mount-table path. The caller still validates forbidden scope symlinks.
  if (exists) return realpath(directory)
  const parent = path.dirname(directory)
  if (parent === directory) return directory
  return ancestor(parent)
}

async function probe(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  const result = await promisify(execFile)(command, args, {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, LC_ALL: "C", ...env },
  })
  return result.stdout
}
