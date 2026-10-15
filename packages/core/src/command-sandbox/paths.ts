export * as CommandSandboxPaths from "./paths"

import { lstat, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { CommandSandboxPolicy } from "./policy"

export const resolve = (input: {
  readonly workspace: string
  readonly profile: "workspace" | "read-only"
  readonly protected: ReadonlyArray<string>
}) =>
  Effect.tryPromise({
    try: async () => {
      if (!path.isAbsolute(input.workspace) || input.workspace.includes("\0"))
        throw new Error("Workspace must be an absolute path")
      const original = await lstat(input.workspace)
      if (!original.isDirectory() || original.isSymbolicLink()) throw new Error("Workspace must be a real directory")
      const workspace = await realpath(input.workspace)
      const protectedPaths = [...new Set(input.protected)].sort()
      if (protectedPaths.length > 96) throw new Error("Too many protected paths")
      const entries = await Promise.all([workspace, ...protectedPaths].map(inspect))
      const protectedCanonical = entries.slice(1).map((entry) => entry.path)
      const ancestors = [...new Set(entries.flatMap((entry) => parents(entry.path)))].sort()
      if (ancestors.length > 128) throw new Error("Too many protected ancestors")
      const identities = [...new Map(entries.map((entry) => [entry.identity.path, entry.identity])).values()]
      const policy = {
        version: 1 as const,
        scope: "native_commands" as const,
        profile: input.profile,
        network: "off" as const,
        workspace,
        identities,
        protected: protectedCanonical,
        ancestors,
      }
      return CommandSandboxPolicy.freeze({ ...policy, revision: CommandSandboxPolicy.revision(policy) })
    },
    catch: () =>
      new CommandSandboxPolicy.Failure({
        code: "unsafe_path",
        message: "The command sandbox paths could not be safely resolved.",
      }),
  })

export const verify = (policy: CommandSandboxPolicy.Confined) =>
  Effect.tryPromise({
    try: async () => {
      await Promise.all(
        policy.identities.map(async (identity) => {
          const current = await lstat(identity.path, { bigint: true })
          if (
            current.isSymbolicLink() ||
            current.dev.toString() !== identity.dev ||
            current.ino.toString() !== identity.ino ||
            current.isDirectory() !== identity.directory ||
            (!identity.directory && current.nlink !== 1n)
          )
            throw new Error("Sandbox authority path changed")
        }),
      )
      // A previously absent protected name may now exist; validate its canonical destination too.
      await Promise.all(
        policy.protected.map(async (value) => {
          const current = await inspect(value)
          if (current.path !== value) throw new Error("Protected path changed destination")
        }),
      )
    },
    catch: () =>
      new CommandSandboxPolicy.Failure({
        code: "unsafe_path",
        message: "A command sandbox authority path changed or became unsafe.",
      }),
  })

async function inspect(
  value: string,
): Promise<{ path: string; identity: CommandSandboxPolicy.Confined["identities"][number] }> {
  if (!path.isAbsolute(value) || value.includes("\0") || Buffer.byteLength(value) > 4096)
    throw new Error("Invalid protected path")
  const current = await lstat(value, { bigint: true }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (!current) {
    const parent = await inspect(path.dirname(value))
    return { path: path.join(parent.path, path.basename(value)), identity: parent.identity }
  }
  if (current.isSymbolicLink()) throw new Error("Protected paths must not be symbolic links")
  if (!current.isDirectory() && (!current.isFile() || current.nlink !== 1n))
    throw new Error("Protected file must have one link")
  const canonical = await realpath(value)
  const physical = await stat(canonical, { bigint: true })
  return {
    path: canonical,
    identity: {
      path: canonical,
      dev: physical.dev.toString(),
      ino: physical.ino.toString(),
      directory: physical.isDirectory(),
    },
  }
}

function parents(value: string): string[] {
  return value === path.dirname(value) ? [value] : [value, ...parents(path.dirname(value))]
}
